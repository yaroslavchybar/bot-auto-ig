"""Graceful shutdown manager for Python runner processes.

Provides centralized signal handling, state persistence, and browser
context cleanup. Each runner entry point registers its active profile,
action, and progress so that a termination signal (or parent process
death on Windows via Job Object) can persist a valid snapshot before
the process exits.
"""

import atexit
import logging
import os
import signal
import time
from typing import Any, Callable, Dict, List, Optional

from python.core.storage.state_persistence import load_state, save_state

logger = logging.getLogger(__name__)


class ShutdownManager:
    """Manages graceful shutdown for a single runner process.

    Usage::

        mgr = ShutdownManager()
        mgr.set_state("my_profile", "scroll_feed", 42)
        mgr.add_cleanup(lambda: browser.close())
        mgr.register()          # installs signal handlers + atexit
    """

    def __init__(self) -> None:
        self._profile: Optional[str] = None
        self._action: Optional[str] = None
        self._progress: int = 0
        self._state_callback: Optional[Callable[[], Dict[str, Any]]] = None
        self._cleanup_fns: List[Callable[[], None]] = []
        self._done = False
        self._registered = False
        self._stop_callbacks: List[Callable[[], None]] = []

    # -- state tracking -------------------------------------------------------

    def set_state(
        self,
        profile: str,
        action: str,
        progress: int,
    ) -> None:
        """Update the current runtime state for snapshot persistence."""
        self._profile = profile
        self._action = action
        self._progress = progress

    def set_state_callback(
        self,
        callback: Callable[[], Dict[str, Any]],
    ) -> None:
        """Register a callback that retrieves current state at shutdown time.

        The callback must return a dict with keys ``profile``, ``action``,
        and ``progress``.  When set, the callback takes precedence over
        the static values supplied via :meth:`set_state`, ensuring that
        the persisted snapshot reflects the in-flight runtime state rather
        than a stale placeholder.
        """
        self._state_callback = callback

    def add_cleanup(self, fn: Callable[[], None]) -> None:
        """Register a cleanup callable (e.g. browser close, display release).

        Callables are executed in LIFO order (last registered first).
        Each callable must be safe to call even if the resource has
        already been released.
        """
        self._cleanup_fns.append(fn)

    def add_stop_callback(self, fn: Callable[[], None]) -> None:
        """Register a callback invoked immediately on signal receipt.

        This is useful for setting ``runner.running = False`` so that
        cooperative loops can exit cleanly *before* the heavier cleanup
        runs.
        """
        self._stop_callbacks.append(fn)

    # -- registration ---------------------------------------------------------

    def register(self) -> None:
        """Install signal handlers and atexit hook.

        Safe to call multiple times; subsequent calls are no-ops.
        """
        if self._registered:
            return
        self._registered = True

        for sig_name in ('SIGINT', 'SIGTERM', 'SIGBREAK'):
            sig = getattr(signal, sig_name, None)
            if sig is not None:
                signal.signal(sig, self._signal_handler)

        atexit.register(self._run_shutdown)

    # -- internal -------------------------------------------------------------

    def _signal_handler(self, _sig: int, _frame: Any) -> None:
        """Invoked by the OS on SIGINT / SIGTERM / SIGBREAK."""
        # Fire stop callbacks first so cooperative loops can bail out.
        for cb in self._stop_callbacks:
            try:
                cb()
            except Exception:
                pass
        self._run_shutdown()
        raise SystemExit(0)

    def _run_shutdown(self) -> None:
        """Persist state and execute cleanup callables.

        Idempotent: only runs once regardless of how many times it is
        called (signal + atexit).
        """
        if self._done:
            return
        self._done = True

        logger.info('Graceful shutdown initiated')

        # 1. Persist current state iff we have a profile context.
        #    Prefer the state callback (fresh in-flight snapshot) over
        #    the static values seeded via set_state().
        profile = self._profile
        action = self._action
        progress = self._progress
        if self._state_callback is not None:
            try:
                fresh = self._state_callback()
                if isinstance(fresh, dict):
                    profile = fresh.get('profile', profile)
                    action = fresh.get('action', action)
                    progress = fresh.get('progress', progress)
            except Exception as exc:
                logger.error('State callback failed, using fallback: %s', exc)
        if profile and action:
            try:
                # Guard: do not overwrite a state already persisted by a
                # scrolling runtime when it is at least as rich.  Using >=
                # ensures that equal progress with a more specific persisted
                # action (e.g. 'scroll_feed') is not overwritten by the
                # coarser launcher action (e.g. 'scroll_feed_and_reels').
                existing = load_state()
                if (
                    existing is not None
                    and existing.get('profile') == profile
                    and isinstance(existing.get('progress'), (int, float))
                    and existing['progress'] >= progress
                ):
                    logger.info(
                        'Skipping state save: persisted progress %d >= shutdown progress %d',
                        existing['progress'],
                        progress,
                    )
                else:
                    save_state(profile, action, progress)
                    logger.info(
                        'State persisted: profile=%s action=%s progress=%d',
                        profile,
                        action,
                        progress,
                    )
            except Exception as exc:
                logger.error('Failed to persist state: %s', exc)

        # 2. Execute cleanup callables in LIFO order.
        for fn in reversed(self._cleanup_fns):
            try:
                fn()
            except Exception as exc:
                logger.debug('Cleanup function error (ignored): %s', exc)

        logger.info('Graceful shutdown complete')
