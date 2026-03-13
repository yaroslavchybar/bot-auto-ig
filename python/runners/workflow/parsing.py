from typing import Any, Dict, List, Optional


def _parse_int(value: Any, default: int) -> int:
    try:
        return int(str(value).strip().split()[0])
    except Exception:
        return default


def _parse_float(value: Any, default: float) -> float:
    try:
        return float(str(value).strip().split()[0])
    except Exception:
        return default


def _parse_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    normalized = str(value).strip().lower()
    if normalized in {'1', 'true', 'yes', 'on'}:
        return True
    if normalized in {'0', 'false', 'no', 'off'}:
        return False
    return default


def _pick_first(mapping: Dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in mapping and mapping.get(key) is not None:
            return mapping.get(key)
    return None


def _normalize_string_list(value: Any) -> List[str]:
    if isinstance(value, list):
        raw_values = value
    elif isinstance(value, str):
        raw_values = []
        for line in value.splitlines():
            raw_values.extend(line.split(','))
    else:
        raw_values = []

    seen: set[str] = set()
    normalized: List[str] = []
    for raw in raw_values:
        cleaned = str(raw or '').strip().replace('@', '')
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(cleaned)
    return normalized


def _parse_retry_backoff_seconds(value: Any) -> List[int]:
    defaults = [30, 120, 600, 1800]
    if isinstance(value, (int, float)):
        seconds = max(1, int(value))
        return [seconds]

    parts = _normalize_string_list(value)
    parsed: List[int] = []
    for part in parts:
        try:
            parsed.append(max(1, int(float(part))))
        except Exception:
            continue
    return parsed or defaults


def _profile_daily_scraping_limit(
    profile: Optional[Dict[str, Any]],
) -> Optional[int]:
    if not isinstance(profile, dict):
        return None
    value = profile.get('daily_scraping_limit')
    if value is None:
        return None
    try:
        numeric = int(float(value))
    except Exception:
        return None
    return max(0, numeric)


def _profile_daily_scraping_used(profile: Optional[Dict[str, Any]]) -> int:
    if not isinstance(profile, dict):
        return 0
    value = profile.get('daily_scraping_used')
    try:
        numeric = int(float(value))
    except Exception:
        return 0
    return max(0, numeric)


def _profile_remaining_daily_scraping_capacity(
    profile: Optional[Dict[str, Any]],
) -> Optional[int]:
    limit = _profile_daily_scraping_limit(profile)
    if limit is None:
        return None
    used = _profile_daily_scraping_used(profile)
    return max(0, limit - used)
