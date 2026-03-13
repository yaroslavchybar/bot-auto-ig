import json
import logging
import sys
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import UUID


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


def _json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value).decode('utf-8', errors='replace')
    if isinstance(value, Enum):
        enum_value = value.value
        if isinstance(enum_value, (str, int, float, bool)) or enum_value is None:
            return enum_value
        return str(value)
    if isinstance(value, BaseException):
        return str(value) or repr(value)
    return str(value)


def _safe_event_summary(event: dict[str, Any]) -> dict[str, Any]:
    return {
        'keys': list(event.keys()),
        'value_types': {key: type(value).__name__ for key, value in event.items()},
        'has_nested_data': any(isinstance(value, (dict, list, tuple, set)) for value in event.values()),
    }


def emit_event(event_type: str, **data: Any) -> None:
    event = {**data, 'type': event_type, 'ts': _now_iso()}
    try:
        payload = json.dumps(event, default=_json_default)
    except Exception as exc:
        payload = json.dumps(
            {
                'type': event_type,
                'ts': event['ts'],
                'serialization_error': f'{type(exc).__name__}: {exc}',
                'raw_event': _safe_event_summary(event),
            },
            default=str,
        )
    sys.stdout.write(f'__EVENT__{payload}__EVENT__\n')
    sys.stdout.flush()
