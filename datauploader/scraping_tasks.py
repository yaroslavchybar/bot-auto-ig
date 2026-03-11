"""Helpers for scraping-task payloads and manifest/chunk storage."""

from typing import Any

USER_COLLECTION_KEYS = ("users", "rawUsers", "accounts")
EXPORT_STORAGE_ID_KEYS = ("exportStorageId", "export_storage_id")
CHUNK_COLLECTION_KEYS = (
    "chunkRefs",
    "chunks",
    "chunkStorageIds",
    "chunk_storage_ids",
    "chunkIds",
    "chunk_ids",
    "artifacts",
    "files",
)
CHUNK_STORAGE_ID_KEYS = (
    "storageId",
    "storage_id",
    "chunkStorageId",
    "chunk_storage_id",
    "id",
)


def _clean_storage_id(value: Any) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _append_unique_storage_id(storage_ids: list[str], seen: set[str], value: Any) -> None:
    storage_id = _clean_storage_id(value)
    if not storage_id or storage_id in seen:
        return
    seen.add(storage_id)
    storage_ids.append(storage_id)


def get_nested_storage_id(payload: Any, keys: tuple[str, ...]) -> str | None:
    if not isinstance(payload, dict):
        return None
    for key in keys:
        value = payload.get(key)
        storage_id = _clean_storage_id(value)
        if storage_id:
            return storage_id
    return None


def has_user_collection(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    return any(isinstance(payload.get(key), list) for key in USER_COLLECTION_KEYS)


def extract_users_from_payload(payload: Any) -> list[Any]:
    if not isinstance(payload, dict):
        return []

    for key in USER_COLLECTION_KEYS:
        value = payload.get(key)
        if isinstance(value, list):
            return value

    collected: list[Any] = []
    for key in ("chunks", "artifacts", "files"):
        value = payload.get(key)
        if not isinstance(value, list):
            continue
        for item in value:
            collected.extend(extract_users_from_payload(item))
        if collected:
            return collected

    return []


def extract_chunk_storage_ids(manifest_payload: Any, task: dict[str, Any] | None = None) -> list[str]:
    storage_ids: list[str] = []
    seen: set[str] = set()

    if isinstance(manifest_payload, dict):
        for key in CHUNK_COLLECTION_KEYS:
            value = manifest_payload.get(key)
            if not isinstance(value, list):
                continue
            for item in value:
                if isinstance(item, str):
                    _append_unique_storage_id(storage_ids, seen, item)
                    continue
                if not isinstance(item, dict):
                    continue
                for item_key in CHUNK_STORAGE_ID_KEYS:
                    if item_key in item:
                        _append_unique_storage_id(storage_ids, seen, item.get(item_key))
                        break

    if isinstance(task, dict):
        chunk_refs = task.get("chunkRefs")
        if isinstance(chunk_refs, list):
            for item in chunk_refs:
                if not isinstance(item, dict):
                    continue
                _append_unique_storage_id(storage_ids, seen, item.get("storageId"))

    return storage_ids


def estimate_task_row_count(task: dict[str, Any]) -> int | None:
    stats = task.get("stats")
    if isinstance(stats, dict):
        deduped = stats.get("deduped")
        if isinstance(deduped, (int, float)) and deduped >= 0:
            return int(deduped)
        scraped = stats.get("scraped")
        if isinstance(scraped, (int, float)) and scraped >= 0:
            return int(scraped)

    chunk_refs = task.get("chunkRefs")
    if isinstance(chunk_refs, list):
        total = 0
        found = False
        for item in chunk_refs:
            if not isinstance(item, dict):
                continue
            count = item.get("count")
            if isinstance(count, (int, float)) and count >= 0:
                total += int(count)
                found = True
        if found:
            return total

    return None


def normalize_task_row(task: Any) -> dict[str, Any]:
    if not isinstance(task, dict):
        return {}

    normalized = dict(task)
    effective_storage_id = (
        _clean_storage_id(task.get("exportStorageId"))
        or _clean_storage_id(task.get("manifestStorageId"))
        or _clean_storage_id(task.get("storageId"))
    )
    if effective_storage_id:
        normalized["storageId"] = effective_storage_id

    row_count = estimate_task_row_count(task)
    if row_count is not None:
        normalized["rowCount"] = row_count

    if not normalized.get("targetUsername"):
        targets = normalized.get("targets")
        if isinstance(targets, list):
            cleaned = [str(value).strip() for value in targets if str(value).strip()]
            if cleaned:
                normalized["targetUsername"] = "\n".join(cleaned)

    return normalized


def build_manifest_payload(
    task: dict[str, Any],
    manifest_payload: Any,
    chunk_payloads: list[dict[str, Any]],
) -> dict[str, Any]:
    combined = dict(manifest_payload) if isinstance(manifest_payload, dict) else {}
    users: list[Any] = []
    for payload in chunk_payloads:
        users.extend(extract_users_from_payload(payload))

    combined["users"] = users
    combined["chunkCount"] = len(chunk_payloads)
    combined["storageKind"] = "manifest"
    combined.setdefault("taskId", task.get("_id"))
    return combined
