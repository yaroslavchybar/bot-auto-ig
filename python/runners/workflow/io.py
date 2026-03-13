import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def _configure_stdio() -> None:
    try:
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    try:
        if hasattr(sys.stderr, 'reconfigure'):
            sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass


_configure_stdio()

_log_stream_handler = logging.StreamHandler(sys.stdout)
_log_stream_handler.setFormatter(logging.Formatter('%(levelname)s: %(message)s'))

_logger = logging.getLogger('workflow_runner')
_logger.handlers.clear()
_logger.addHandler(_log_stream_handler)
_logger.setLevel(logging.INFO)
_logger.propagate = False


def log(message: str) -> None:
    level = logging.INFO
    try:
        normalized = str(message).lstrip().lower()
        if normalized.startswith(('ошибка', 'error', 'exception')):
            level = logging.ERROR
        elif normalized.startswith(('warning', 'warn', 'внимание')):
            level = logging.WARNING
    except Exception:
        level = logging.INFO
    _logger.log(level, str(message))
    sys.stdout.flush()


def emit_event(event_type: str, **data: Any) -> None:
    event = {**data, 'type': event_type, 'ts': _now_iso()}
    sys.stdout.write(f'__EVENT__{json.dumps(event)}__EVENT__\n')
    sys.stdout.flush()
