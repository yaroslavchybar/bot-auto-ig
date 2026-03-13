import json
import os
import random
import sys
import time
from typing import Any, Dict, List, Optional
from urllib.parse import quote


def _project_root() -> str:
    here = os.path.abspath(os.path.dirname(__file__))
    return os.path.abspath(os.path.join(here, '..', '..'))


sys.path.insert(0, _project_root())

from python.actions.browsing import scroll_feed, scroll_reels
from python.actions.engagement.approve.session import approve_follow_requests
from python.actions.engagement.follow.common import normalize_range
from python.actions.engagement.follow.session import follow_usernames
from python.actions.engagement.unfollow.session import unfollow_usernames
from python.actions.messaging.session import send_messages
from python.actions.stories import watch_stories
from python.browser.display import DisplayManager
from python.core.config import PROJECT_URL, SECRET_KEY
from python.core.models import ThreadsAccount
from python.core.storage.atomic import atomic_write_json
from python.core.utils import apply_count_limit, create_browser_context
from python.database.accounts import InstagramAccountsClient
from python.database.messages import MessageTemplatesClient
from python.database.profiles import ProfilesClient
from python.runners.workflow.bootstrap import (
    _extract_start_browser_settings,
    _find_start_node,
    _workflow_has_activity,
    fetch_profiles_for_lists,
)
from python.runners.workflow.entrypoint import main
from python.runners.workflow.graph import _build_edge_index, _next_node
from python.runners.workflow.io import _configure_stdio, _now_iso, emit_event, log
from python.runners.workflow.parsing import (
    _normalize_string_list,
    _parse_bool,
    _parse_float,
    _parse_int,
    _parse_retry_backoff_seconds,
    _pick_first,
    _profile_daily_scraping_limit,
    _profile_daily_scraping_used,
    _profile_remaining_daily_scraping_capacity,
)
from python.runners.workflow.runtime import WorkflowRunner


def _workflow_headers() -> Dict[str, str]:
    headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    }
    if SECRET_KEY:
        headers['Authorization'] = f'Bearer {SECRET_KEY}'
    return headers


def _convex_post_json(path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if not PROJECT_URL:
        raise RuntimeError('Convex PROJECT_URL is not configured')
    try:
        import requests

        response = requests.post(
            f'{PROJECT_URL}{path}',
            json=payload,
            headers=_workflow_headers(),
            timeout=60,
        )
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict):
            raise RuntimeError(f'Unexpected response shape for {path}')
        return data
    except Exception as exc:
        raise RuntimeError(f'Convex request failed for {path}: {exc}') from exc


def _convex_get_json(path: str) -> Any:
    if not PROJECT_URL:
        raise RuntimeError('Convex PROJECT_URL is not configured')
    try:
        import requests

        response = requests.get(
            f'{PROJECT_URL}{path}',
            headers=_workflow_headers(),
            timeout=60,
        )
        response.raise_for_status()
        return response.json()
    except Exception as exc:
        raise RuntimeError(f'Convex request failed for {path}: {exc}') from exc


def _build_scrape_export_payload(
    workflow_id: str,
    node_id: str,
    profile_name: str,
    kind: str,
    targets: List[str],
    users: List[Any],
) -> Dict[str, Any]:
    return {
        'workflowId': workflow_id,
        'nodeId': node_id,
        'activityId': 'scrape_relationships',
        'profileName': profile_name,
        'kind': kind,
        'targets': targets,
        'users': users,
        'count': len(users),
        'scrapedAt': int(time.time() * 1000),
        'storageKind': 'export',
    }


def _scraped_user_key(user: Any) -> str:
    if isinstance(user, dict):
        for key in ('id', 'pk', 'username', 'userName', 'user_name', 'login'):
            value = user.get(key)
            if value is None:
                continue
            cleaned = str(value).strip()
            if cleaned:
                return cleaned.lower()
        try:
            return json.dumps(user, sort_keys=True, ensure_ascii=False)
        except Exception:
            return str(user)
    if isinstance(user, str):
        return user.strip().lower()
    return str(user)


def _dedupe_scraped_users(users: List[Any]) -> List[Any]:
    seen: set[str] = set()
    out: List[Any] = []
    for user in users:
        key = _scraped_user_key(user)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(user)
    return out


def _extract_users_from_payload(payload: Any) -> List[Any]:
    if not isinstance(payload, dict):
        return []
    for key in ('users', 'rawUsers', 'accounts'):
        value = payload.get(key)
        if isinstance(value, list):
            return value
    return []


def _store_artifact_payload(payload: Dict[str, Any]) -> str:
    result = _convex_post_json('/api/workflow-artifacts/store-artifact', {'payload': payload})
    storage_id = str(result.get('storageId') or '').strip()
    if not storage_id:
        raise RuntimeError('Artifact storage response did not include storageId')
    return storage_id


def _resume_snapshot_path(workflow_id: str, node_id: str) -> str:
    safe_workflow = ''.join(ch if ch.isalnum() else '_' for ch in str(workflow_id or 'workflow'))
    safe_node = ''.join(ch if ch.isalnum() else '_' for ch in str(node_id or 'node'))
    return os.path.join(_project_root(), 'data', 'workflow_resume', f'{safe_workflow}_{safe_node}.json')


def _store_resume_snapshot(path: str, payload: Dict[str, Any]) -> str:
    atomic_write_json(path, payload)
    return path


def _delete_resume_snapshot(path: Optional[str]) -> None:
    cleaned = str(path or '').strip()
    if not cleaned:
        return
    try:
        os.unlink(cleaned)
    except (FileNotFoundError, OSError):
        return


def _load_users_from_resume_snapshot(path: str) -> List[Any]:
    cleaned = str(path or '').strip()
    if not cleaned or not os.path.exists(cleaned):
        return []
    try:
        with open(cleaned, 'r', encoding='utf-8') as fh:
            payload = json.load(fh)
    except Exception as exc:
        raise RuntimeError(f'Failed to load resume snapshot for {cleaned}: {exc}') from exc
    return _extract_users_from_payload(payload)


def _load_users_from_storage(storage_id: str) -> List[Any]:
    cleaned = str(storage_id or '').strip()
    if not cleaned:
        return []
    url = _convex_get_json(f'/api/workflow-artifacts/storage-url?storageId={quote(cleaned)}')
    if not isinstance(url, str) or not url.strip():
        return []
    try:
        import requests

        response = requests.get(url, timeout=60)
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        raise RuntimeError(f'Failed to load artifact payload for {cleaned}: {exc}') from exc
    return _extract_users_from_payload(payload)


def _fetch_profiles_for_lists(
    list_ids: List[str],
    *,
    cooldown_minutes: int = 0,
    enforce_cooldown: bool = False,
) -> List[Dict[str, Any]]:
    return fetch_profiles_for_lists(
        PROJECT_URL,
        SECRET_KEY,
        list_ids,
        cooldown_minutes=cooldown_minutes,
        enforce_cooldown=enforce_cooldown,
    )


def _choose_weighted(handles: List[str], weights_str: str) -> str:
    weights = []
    try:
        parts = [part.strip() for part in str(weights_str or '').split(',') if part.strip()]
        weights = [max(0.0, float(part)) for part in parts]
    except Exception:
        weights = []
    if len(weights) < len(handles):
        weights = weights + [1.0] * (len(handles) - len(weights))
    weights = weights[: len(handles)]
    total = sum(weights)
    if total <= 0:
        return random.choice(handles)
    point = random.random() * total
    acc = 0.0
    for handle, weight in zip(handles, weights):
        acc += weight
        if point <= acc:
            return handle
    return handles[-1]


if __name__ == '__main__':
    raise SystemExit(main())
