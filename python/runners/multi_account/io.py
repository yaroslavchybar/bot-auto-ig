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

_logger = logging.getLogger(__name__)


def log(message: str) -> None:
    msg = f'[{_now_iso()}] {message}'
    level = logging.INFO
    try:
        normalized = str(message).lstrip().lower()
        if normalized.startswith(('error', 'exception')):
            level = logging.ERROR
    except Exception:
        level = logging.INFO
    _logger.log(level, msg)
    sys.stdout.flush()


def emit_event(event_type: str, **data: Any) -> None:
    event = {'type': event_type, 'ts': _now_iso(), **data}
    sys.stdout.write(f"__EVENT__{json.dumps(event)}__EVENT__\n")
    sys.stdout.flush()
