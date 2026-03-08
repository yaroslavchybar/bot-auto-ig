import json
from typing import Any, Dict, List, Optional


def _is_dict(value: Any) -> bool:
    return isinstance(value, dict)


def _extract_cookie_list(payload: Any) -> List[Any]:
    if isinstance(payload, list):
        return payload
    if not _is_dict(payload):
        raise ValueError("Cookies payload must be a list or object")
    if isinstance(payload.get("cookies"), list):
        return payload["cookies"]
    if isinstance(payload.get("cookie"), list):
        return payload["cookie"]
    data = payload.get("data")
    if _is_dict(data) and isinstance(data.get("cookies"), list):
        return data["cookies"]
    raise ValueError("Cookies payload must contain a cookies list")


def _normalize_same_site(value: Any) -> Optional[str]:
    raw = str(value or "").strip().lower()
    if not raw:
        return None
    if raw == "strict":
        return "Strict"
    if raw == "lax":
        return "Lax"
    if raw in {"none", "no_restriction", "unspecified"}:
        return "None"
    return None


def _normalize_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1"}:
            return True
        if lowered in {"false", "0"}:
            return False
    return None


def _normalize_expires(value: Any) -> Optional[float]:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        trimmed = value.strip()
        if not trimmed:
            return None
        try:
            return float(trimmed)
        except ValueError:
            return None
    return None


def normalize_profile_cookies(payload: Any, drop_invalid: bool = False) -> List[Dict[str, Any]]:
    if payload in (None, ""):
        return []

    parsed = payload
    if isinstance(payload, str):
        parsed = json.loads(payload)

    items = _extract_cookie_list(parsed)
    normalized: List[Dict[str, Any]] = []

    for index, cookie in enumerate(items):
        try:
            if not _is_dict(cookie):
                raise ValueError(f"Cookie at index {index} must be an object")

            name = str(cookie.get("name") or "").strip()
            value = str(cookie.get("value") or "").strip()
            if not name:
                raise ValueError(f"Cookie at index {index} is missing name")
            if not value:
                raise ValueError(f"Cookie at index {index} is missing value")

            url = str(cookie.get("url") or "").strip()
            domain = str(cookie.get("domain") or "").strip()
            if not url and not domain:
                raise ValueError(f'Cookie "{name}" must include domain or url')

            entry: Dict[str, Any] = {
                "name": name,
                "value": value,
            }
            if url:
                entry["url"] = url
            else:
                entry["domain"] = domain
                entry["path"] = str(cookie.get("path") or "/").strip() or "/"

            expires = _normalize_expires(cookie.get("expires", cookie.get("expirationDate", cookie.get("expire_time"))))
            if expires is not None:
                entry["expires"] = expires

            http_only = _normalize_bool(cookie.get("httpOnly", cookie.get("http_only")))
            if http_only is not None:
                entry["httpOnly"] = http_only

            secure = _normalize_bool(cookie.get("secure"))
            if secure is not None:
                entry["secure"] = secure

            same_site = _normalize_same_site(cookie.get("sameSite", cookie.get("same_site")))
            if same_site:
                entry["sameSite"] = same_site

            normalized.append(entry)
        except Exception:
            if not drop_invalid:
                raise

    return normalized


def canonical_cookies_json(cookies: List[Dict[str, Any]]) -> str:
    return json.dumps(cookies, separators=(",", ":"))


def extract_instagram_session_id(cookies: List[Dict[str, Any]]) -> Optional[str]:
    for cookie in cookies or []:
        try:
            if cookie.get("name") != "sessionid":
                continue
            domain = str(cookie.get("domain") or cookie.get("url") or "")
            if "instagram.com" not in domain:
                continue
            value = str(cookie.get("value") or "").strip()
            if value:
                return value
        except Exception:
            continue
    return None
