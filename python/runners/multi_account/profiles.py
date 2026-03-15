from typing import Any, Dict, List

import requests

from python.core.config import PROJECT_URL, SECRET_KEY


def _fetch_profiles_for_lists(list_ids: List[str]) -> List[Dict[str, Any]]:
    if not PROJECT_URL or not list_ids:
        return []
    try:
        clean_ids = [str(item).strip().replace('"', '') for item in list_ids if str(item).strip()]
        if not clean_ids:
            return []
        headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }
        if SECRET_KEY:
            headers['Authorization'] = f'Bearer {SECRET_KEY}'
        response = requests.post(
            f'{PROJECT_URL}/api/profiles/by-list-ids',
            json={'listIds': clean_ids},
            headers=headers,
            timeout=30,
        )
        payload = response.json() if 200 <= response.status_code < 300 else []
    except Exception:
        return []
    return _dedupe_profiles(payload)


def _dedupe_profiles(payload: Any) -> List[Dict[str, Any]]:
    if not isinstance(payload, list):
        return []
    seen = set()
    unique: List[Dict[str, Any]] = []
    for profile in payload:
        if not isinstance(profile, dict):
            continue
        profile_id = profile.get('profile_id')
        if not profile_id or profile_id in seen:
            continue
        seen.add(profile_id)
        unique.append(profile)
    return unique
