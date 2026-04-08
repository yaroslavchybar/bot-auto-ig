import json
import os
import random
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from python.core.config import (
    DATAUPLOADER_ACCOUNT_STATUS,
    DATAUPLOADER_DEST_ENVIRONMENTS,
    DATAUPLOADER_ENV,
    DATAUPLOADER_URL,
    PROJECT_URL,
    SECRET_KEY,
)
from python.core.storage.atomic import atomic_write_json


def _project_root() -> str:
    here = os.path.abspath(os.path.dirname(__file__))
    return os.path.abspath(os.path.join(here, '..', '..', '..'))


def _safe_path_fragment(value: Any, default: str) -> str:
    raw = str(value or '').strip()
    cleaned = ''.join(ch if ch.isalnum() else '_' for ch in raw)
    cleaned = cleaned.strip('_')
    return cleaned or default


def _uploads_root() -> Path:
    return Path(_project_root()) / 'data' / 'uploads'


def _local_scrape_artifact_relative_path(
    workflow_id: str,
    node_id: str,
    kind: str,
    *,
    now_ms: int | None = None,
) -> str:
    timestamp = int(now_ms if now_ms is not None else time.time() * 1000)
    safe_workflow = _safe_path_fragment(workflow_id, 'workflow')
    safe_node = _safe_path_fragment(node_id, 'node')
    safe_kind = _safe_path_fragment(kind, 'followers')
    return f'scrapes/{safe_workflow}/{safe_node}_{safe_kind}_{timestamp}.json'


def _resolve_local_artifact_path(relative_path: str) -> Path:
    cleaned = str(relative_path or '').strip().replace('\\', '/').lstrip('/')
    if not cleaned:
        raise RuntimeError('Local artifact path is required')
    uploads_root = _uploads_root().resolve()
    resolved = (uploads_root / Path(cleaned)).resolve()
    try:
        resolved.relative_to(uploads_root)
    except ValueError as exc:
        raise RuntimeError('Invalid local artifact path') from exc
    return resolved


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


def _datauploader_post_json(path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if not DATAUPLOADER_URL:
        raise RuntimeError('Datauploader URL is not configured')
    try:
        import requests

        response = requests.post(
            f'{DATAUPLOADER_URL}{path}',
            json=payload,
            headers={
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            timeout=120,
        )
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict):
            raise RuntimeError(f'Unexpected response shape for {path}')
        return data
    except Exception as exc:
        raise RuntimeError(f'Datauploader request failed for {path}: {exc}') from exc


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


def _build_scrape_processing_payload(
    workflow_id: str,
    workflow_name: str,
    node_id: str,
    node_label: str,
    profile_name: str,
    kind: str,
    targets: List[str],
    users: List[Any],
    stats: Dict[str, Any],
    metadata: Dict[str, Any],
) -> Dict[str, Any]:
    return {
        'workflowId': workflow_id,
        'workflowName': workflow_name,
        'nodeId': node_id,
        'nodeLabel': node_label,
        'kind': kind,
        'targets': list(targets),
        'sourceProfileName': profile_name,
        'users': list(users),
        'stats': dict(stats),
        'metadata': dict(metadata),
        'env': DATAUPLOADER_ENV,
        'environments': list(DATAUPLOADER_DEST_ENVIRONMENTS),
        'accountStatus': DATAUPLOADER_ACCOUNT_STATUS,
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


def _store_local_artifact_payload(relative_path: str, payload: Dict[str, Any]) -> str:
    output_path = _resolve_local_artifact_path(relative_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_json(str(output_path), payload)
    return relative_path


def _load_users_from_local_artifact(relative_path: str) -> List[Any]:
    input_path = _resolve_local_artifact_path(relative_path)
    if not input_path.exists():
        return []
    try:
        with input_path.open('r', encoding='utf-8') as fh:
            payload = json.load(fh)
    except Exception as exc:
        raise RuntimeError(f'Failed to load local artifact payload for {relative_path}: {exc}') from exc
    return _extract_users_from_payload(payload)


def _local_artifact_exists(relative_path: str) -> bool:
    return _resolve_local_artifact_path(relative_path).exists()


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
