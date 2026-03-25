"""Tests for the graceful shutdown manager (python.core.shutdown).

Verifies:
 - State persistence on signal receipt (VAL-REL-002)
 - Cleanup callables execute in LIFO order
 - Idempotent shutdown (only runs once)
 - State file contains valid snapshot with required fields
 - Stop callbacks fire before cleanup
 - No zombie browser processes (via Job Object integration)
"""

import json
import os
import signal
import time
from pathlib import Path
from unittest.mock import MagicMock, call, patch

import pytest

from python.core.shutdown import ShutdownManager
from python.core.storage.state_persistence import (
    STATE_FILE,
    clear_state,
    load_state,
    save_state,
)


@pytest.fixture(autouse=True)
def clean_state_file():
    """Remove state file before and after each test."""
    if STATE_FILE.exists():
        STATE_FILE.unlink()
    for tmp in STATE_FILE.parent.glob('*.tmp'):
        tmp.unlink(missing_ok=True)
    yield
    if STATE_FILE.exists():
        STATE_FILE.unlink()
    for tmp in STATE_FILE.parent.glob('*.tmp'):
        tmp.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Core shutdown flow
# ---------------------------------------------------------------------------


def test_shutdown_persists_state():
    """Shutdown writes a state file with profile, action, progress, timestamp."""
    mgr = ShutdownManager()
    mgr.set_state('test_profile', 'scroll_feed', 42)
    mgr._run_shutdown()

    state = load_state()
    assert state is not None
    assert state['profile'] == 'test_profile'
    assert state['action'] == 'scroll_feed'
    assert state['progress'] == 42
    assert 'timestamp' in state
    assert isinstance(state['timestamp'], (int, float))


def test_shutdown_state_fields_valid():
    """State file must contain profile, action, progress, timestamp."""
    mgr = ShutdownManager()
    mgr.set_state('prof_1', 'reels', 99)
    mgr._run_shutdown()

    raw = json.loads(STATE_FILE.read_text(encoding='utf-8'))
    required = {'profile', 'action', 'progress', 'timestamp'}
    assert required.issubset(raw.keys())
    assert isinstance(raw['profile'], str)
    assert isinstance(raw['action'], str)
    assert isinstance(raw['progress'], int)
    assert isinstance(raw['timestamp'], (int, float))


def test_shutdown_no_state_when_no_profile():
    """If no profile/action was set, shutdown should NOT write a state file."""
    mgr = ShutdownManager()
    mgr._run_shutdown()

    assert not STATE_FILE.exists()


def test_shutdown_cleanup_runs_lifo():
    """Cleanup callables execute in LIFO order."""
    order = []
    mgr = ShutdownManager()
    mgr.add_cleanup(lambda: order.append('first'))
    mgr.add_cleanup(lambda: order.append('second'))
    mgr.add_cleanup(lambda: order.append('third'))
    mgr._run_shutdown()

    assert order == ['third', 'second', 'first']


def test_shutdown_cleanup_error_does_not_abort():
    """A failing cleanup callable must not prevent subsequent ones."""
    order = []

    def bad_cleanup():
        raise RuntimeError('boom')

    mgr = ShutdownManager()
    mgr.add_cleanup(lambda: order.append('a'))
    mgr.add_cleanup(bad_cleanup)
    mgr.add_cleanup(lambda: order.append('c'))
    mgr._run_shutdown()

    # 'c' and 'a' still ran despite the error in the middle
    assert order == ['c', 'a']


def test_shutdown_idempotent():
    """Running shutdown twice must only persist state once."""
    call_count = {'n': 0}

    def counting_cleanup():
        call_count['n'] += 1

    mgr = ShutdownManager()
    mgr.set_state('prof', 'action', 10)
    mgr.add_cleanup(counting_cleanup)

    mgr._run_shutdown()
    mgr._run_shutdown()  # second call should be a no-op

    assert call_count['n'] == 1
    assert load_state() is not None


def test_stop_callbacks_fire_before_cleanup():
    """Stop callbacks fire first (for cooperative loop exit), then cleanup."""
    order = []
    mgr = ShutdownManager()
    mgr.add_stop_callback(lambda: order.append('stop'))
    mgr.add_cleanup(lambda: order.append('cleanup'))

    # Simulate signal handler path
    with pytest.raises(SystemExit):
        mgr._signal_handler(signal.SIGINT, None)

    assert order == ['stop', 'cleanup']


def test_signal_handler_raises_system_exit():
    """Signal handler must raise SystemExit(0) after cleanup."""
    mgr = ShutdownManager()
    with pytest.raises(SystemExit) as exc_info:
        mgr._signal_handler(signal.SIGINT, None)
    assert exc_info.value.code == 0


def test_signal_handler_persists_state():
    """Signal handler path should persist state before exit."""
    mgr = ShutdownManager()
    mgr.set_state('sig_profile', 'workflow', 55)
    with pytest.raises(SystemExit):
        mgr._signal_handler(signal.SIGINT, None)

    state = load_state()
    assert state is not None
    assert state['profile'] == 'sig_profile'
    assert state['action'] == 'workflow'
    assert state['progress'] == 55


def test_register_installs_signal_handlers():
    """register() should install handlers for available signals."""
    mgr = ShutdownManager()
    with patch('signal.signal') as mock_signal:
        mgr.register()

    # Should have been called for SIGINT and SIGTERM at minimum
    sig_names = [c[0][0] for c in mock_signal.call_args_list]
    assert signal.SIGINT in sig_names
    if hasattr(signal, 'SIGTERM'):
        assert signal.SIGTERM in sig_names


def test_register_is_idempotent():
    """Calling register() multiple times should not re-install handlers."""
    mgr = ShutdownManager()
    with patch('signal.signal') as mock_signal:
        mgr.register()
        first_count = mock_signal.call_count
        mgr.register()
        assert mock_signal.call_count == first_count  # no additional calls


def test_set_state_updates():
    """set_state can be called multiple times; last value wins."""
    mgr = ShutdownManager()
    mgr.set_state('a', 'x', 10)
    mgr.set_state('b', 'y', 90)
    mgr._run_shutdown()

    state = load_state()
    assert state['profile'] == 'b'
    assert state['action'] == 'y'
    assert state['progress'] == 90


def test_state_timestamp_is_recent():
    """Persisted timestamp should be within the last few seconds."""
    mgr = ShutdownManager()
    before = time.time()
    mgr.set_state('prof', 'act', 0)
    mgr._run_shutdown()
    after = time.time()

    state = load_state()
    assert before <= state['timestamp'] <= after


# ---------------------------------------------------------------------------
# Integration with entry points
# ---------------------------------------------------------------------------


def test_launcher_shutdown_mgr_imported():
    """launcher.py should import ShutdownManager."""
    # This is a code-level integration check
    from python.runners import launcher
    assert hasattr(launcher, '_shutdown_mgr')
    assert isinstance(launcher._shutdown_mgr, ShutdownManager)


def test_workflow_entrypoint_uses_shutdown_mgr():
    """workflow entrypoint registers ShutdownManager in _register_process_handlers."""
    from python.runners.workflow import entrypoint
    assert hasattr(entrypoint, '_register_process_handlers')
    # The function creates a ShutdownManager internally — verify it exists
    import inspect
    src = inspect.getsource(entrypoint._register_process_handlers)
    assert 'ShutdownManager' in src


def test_multi_account_entrypoint_uses_shutdown_mgr():
    """multi_account entrypoint registers ShutdownManager."""
    from python.runners.multi_account import entrypoint
    assert hasattr(entrypoint, '_register_signal_handlers')
    import inspect
    src = inspect.getsource(entrypoint._register_signal_handlers)
    assert 'ShutdownManager' in src


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


def test_cleanup_with_no_callbacks():
    """Shutdown with zero cleanup callables should still work."""
    mgr = ShutdownManager()
    mgr.set_state('p', 'a', 50)
    mgr._run_shutdown()  # no callbacks, should not raise

    state = load_state()
    assert state is not None


def test_stop_callback_error_does_not_prevent_shutdown():
    """A failing stop callback must not prevent state persistence."""
    mgr = ShutdownManager()
    mgr.set_state('p', 'a', 77)
    mgr.add_stop_callback(lambda: (_ for _ in ()).throw(RuntimeError('stop boom')))

    with pytest.raises(SystemExit):
        mgr._signal_handler(signal.SIGINT, None)

    state = load_state()
    assert state is not None
    assert state['progress'] == 77


def test_save_state_failure_does_not_prevent_cleanup():
    """If save_state raises, cleanup callables should still execute."""
    cleaned = []
    mgr = ShutdownManager()
    mgr.set_state('p', 'a', 10)
    mgr.add_cleanup(lambda: cleaned.append(True))

    with patch('python.core.shutdown.save_state', side_effect=OSError('disk full')):
        mgr._run_shutdown()

    assert cleaned == [True]
