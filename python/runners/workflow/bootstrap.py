from typing import Any, Dict, List, Optional

from python.runners.workflow.parsing import (
    _parse_bool,
    _parse_int,
    _pick_first,
)


def _workflow_has_activity(nodes: List[Dict[str, Any]], activity_id: str) -> bool:
    for node in nodes:
        node_data = node.get('data') if isinstance(node.get('data'), dict) else {}
        if str(node_data.get('activityId') or '') == activity_id:
            return True
    return False


def _extract_start_browser_settings(
    nodes: List[Dict[str, Any]],
    start_data: Dict[str, Any],
) -> Dict[str, Any]:
    config = _start_browser_config(nodes)
    profile_cooldown = _cooldown_values(config, 'profileReopenCooldown', 'profile_reopen_cooldown', 'Minutes')
    messaging_cooldown = _cooldown_values(config, 'messagingCooldown', 'messaging_cooldown', 'Hours')
    headless_raw = _pick_first(config, 'headlessMode', 'headless', 'headless_mode')
    if headless_raw is None:
        headless_raw = start_data.get('headlessMode')
    return {
        'headless': _parse_bool(headless_raw, default=_parse_bool(start_data.get('headlessMode'), False)),
        'parallel_profiles': _parallel_profiles(config),
        'profile_reopen_cooldown_enabled': _parse_bool(profile_cooldown['enabled'], False),
        'profile_reopen_cooldown_minutes': max(0, _parse_int(profile_cooldown['value'], 30)),
        'messaging_cooldown_enabled': _parse_bool(messaging_cooldown['enabled'], False),
        'messaging_cooldown_hours': max(0, _parse_int(messaging_cooldown['value'], 2)),
    }


def _start_browser_config(nodes: List[Dict[str, Any]]) -> Dict[str, Any]:
    for node in nodes:
        node_data = node.get('data') if isinstance(node.get('data'), dict) else {}
        if str(node_data.get('activityId') or '') != 'start_browser':
            continue
        node_config = node_data.get('config')
        if isinstance(node_config, dict):
            return dict(node_config)
    return {}


def _cooldown_values(config: Dict[str, Any], legacy_key: str, snake_legacy_key: str, suffix: str) -> Dict[str, Any]:
    legacy_value = _pick_first(config, legacy_key, snake_legacy_key)
    enabled_raw = _pick_first(
        config,
        f'{legacy_key}Enabled',
        f'{snake_legacy_key}_enabled',
    )
    value_raw = _pick_first(
        config,
        f'{legacy_key}{suffix}',
        f'{snake_legacy_key}_{suffix.lower()}',
    )
    if enabled_raw is None and legacy_value is not None:
        enabled_raw = True
    if value_raw is None:
        value_raw = legacy_value
    return {'enabled': enabled_raw, 'value': value_raw}


def _parallel_profiles(config: Dict[str, Any]) -> int:
    return max(
        1,
        min(
            10,
            _parse_int(_pick_first(config, 'parallelProfiles', 'parallel_profiles'), 1),
        ),
    )


def _find_start_node(nodes: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    for node in nodes:
        if node.get('type') == 'start':
            return node
    for node in nodes:
        if str(node.get('id')) == 'start_node':
            return node
    return None


def fetch_profiles_for_lists(
    project_url: str,
    secret_key: str,
    list_ids: List[str],
    *,
    cooldown_minutes: int = 0,
    enforce_cooldown: bool = False,
) -> List[Dict[str, Any]]:
    if not project_url:
        return []

    clean_ids = [str(list_id).strip().replace('"', '') for list_id in list_ids if str(list_id).strip()]
    if not clean_ids:
        return []

    headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    }
    if secret_key:
        headers['Authorization'] = f'Bearer {secret_key}'

    endpoint = '/api/profiles/available'
    if not (enforce_cooldown and cooldown_minutes > 0):
        endpoint = '/api/profiles/by-list-ids'

    payload: Dict[str, Any] = {'listIds': clean_ids}
    if endpoint.endswith('/available'):
        payload['cooldownMinutes'] = max(0, int(cooldown_minutes))

    try:
        import requests

        response = requests.post(
            f'{project_url}{endpoint}',
            json=payload,
            headers=headers,
            timeout=30,
        )
        data = response.json() if 200 <= response.status_code < 300 else []
        if not isinstance(data, list):
            return []

        unique: List[Dict[str, Any]] = []
        seen: set[str] = set()
        for profile in data:
            if not isinstance(profile, dict):
                continue
            key = str(profile.get('profile_id') or profile.get('name') or '').strip()
            if not key or key in seen:
                continue
            seen.add(key)
            unique.append(profile)
        return unique
    except Exception:
        return []
