import json
from typing import Any, Optional
from urllib.parse import urlparse


def mask_session_id(session_id: Optional[str]) -> str:
    value = str(session_id or '').strip()
    if not value:
        return 'missing'
    if len(value) <= 8:
        return f'len={len(value)}:{value[:2]}***'
    return f'len={len(value)}:{value[:4]}...{value[-4:]}'


def summarize_proxy(proxy: Optional[str]) -> str:
    value = str(proxy or '').strip()
    if not value:
        return 'none'

    try:
        parsed = urlparse(value if '://' in value else f'http://{value}')
        scheme = parsed.scheme or 'http'
        host = parsed.hostname or 'unknown-host'
        port = parsed.port
        auth = 'auth' if parsed.username or parsed.password else 'no-auth'
        return f'{scheme}://{host}{f":{port}" if port else ""} ({auth})'
    except Exception:
        return 'unparseable'


def body_preview(text: Optional[str], limit: int = 240) -> str:
    value = str(text or '').replace('\r', ' ').replace('\n', ' ').strip()
    if not value:
        return ''
    return value[:limit]


def response_preview(response: Any, limit: int = 240) -> str:
    try:
        return body_preview(getattr(response, 'text', ''), limit=limit)
    except Exception:
        return ''


def json_keys(payload: Any) -> list[str]:
    if isinstance(payload, dict):
        return sorted(str(k) for k in payload.keys())
    return []


def safe_json_loads(text: Optional[str]) -> Any:
    value = str(text or '').strip()
    if not value:
        return None
    try:
        return json.loads(value)
    except Exception:
        return None
