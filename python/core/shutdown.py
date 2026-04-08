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
import sys
import time
from typing import Any, Callable, Dict, List, Optional

from python.core.storage.state_persistence import load_state, save_state

logger = logging.getLogger(__name__)


def _iter_active_loggers(base_logger: logging.Logger):
    current: Optional[logging.Logger] = base_logger
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        yield current
        seen.add(id(current))
        if not current.propagate:
            break
        current = current.parent


def _can_emit_log(base_logger: logging.Logger) -> bool:
    saw_handler = False
    for current in _iter_active_loggers(base_logger):
        for handler in current.handlers:
            saw_handler = True
            stream = getattr(handler, 'stream', None)
            if stream is not None and getattr(stream, 'closed', False):
                return False
    if not saw_handler and getattr(sys.stderr, 'closed', False):
        return False
    return True


def _safe_log(level: int, message: str, *args: Any) -> None:
    try:
        if not _can_emit_log(logger):
            return
        logger.log(level, message, *args)
    except Exception:
        pass


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

        _safe_log(logging.INFO, 'Graceful shutdown initiated')

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
                _safe_log(logging.ERROR, 'State callback failed, using fallback: %s', exc)
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
                    _safe_log(
                        logging.INFO,
                        'Skipping state save: persisted progress %d >= shutdown progress %d',
                        existing['progress'],
                        progress,
                    )
                else:
                    save_state(profile, action, progress)
                    _safe_log(
                        logging.INFO,
                        'State persisted: profile=%s action=%s progress=%d',
                        profile,
                        action,
                        progress,
                    )
            except Exception as exc:
                _safe_log(logging.ERROR, 'Failed to persist state: %s', exc)

        # 2. Execute cleanup callables in LIFO order.
        for fn in reversed(self._cleanup_fns):
            try:
                fn()
            except Exception as exc:
                _safe_log(logging.DEBUG, 'Cleanup function error (ignored): %s', exc)

        _safe_log(logging.INFO, 'Graceful shutdown complete')
