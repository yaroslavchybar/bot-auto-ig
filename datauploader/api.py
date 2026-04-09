"""FastAPI REST API for CSV data upload and processing."""

import csv
import json
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from clean_data import detect_csv_separator
from filter_instagram import filter_csv, filter_with_keywords, load_all_keyword_sets
from convex_client import (
    convex_mutation,
    convex_query,
    get_keywords,
    insert_scraping_accounts_batch,
    list_keywords,
    remove_keywords,
    upsert_keywords,
)
from scraping_tasks import (
    EXPORT_STORAGE_ID_KEYS,
    build_manifest_payload,
    extract_chunk_storage_ids,
    extract_users_from_payload,
    get_nested_storage_id,
    has_user_collection,
    normalize_task_row,
)
from uploader import extract_usernames_from_scraping_task_payload, upload_usernames_to_convex, upload_accounts_to_convex

import requests

app = FastAPI(title="Data Uploader API", version="1.0.0")

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory job storage (for simplicity - could use Redis in production)
jobs: dict[str, dict[str, Any]] = {}

UPLOAD_DIR = Path("/app/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _resolve_local_artifact_path(relative_path: str) -> Path:
    cleaned = str(relative_path or "").strip().replace("\\", "/").lstrip("/")
    if not cleaned:
        raise HTTPException(status_code=400, detail="Task has no local artifact path")
    uploads_root = UPLOAD_DIR.resolve()
    resolved = (uploads_root / Path(cleaned)).resolve()
    try:
        resolved.relative_to(uploads_root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid local artifact path") from exc
    return resolved


def _load_local_artifact_payload(relative_path: str) -> dict[str, Any]:
    input_path = _resolve_local_artifact_path(relative_path)
    if not input_path.exists():
        raise HTTPException(status_code=404, detail=f"Local artifact file not found: {relative_path}")
    try:
        with input_path.open("r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to read local artifact file: {exc}") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail=f"Invalid local artifact payload for {relative_path}")
    return payload


# ── Keywords endpoints ────────────────────────────────────────────────


class KeywordUploadRequest(BaseModel):
    filename: str
    content: str
    env: str = "dev"


@app.post("/keywords/upload")
async def upload_keywords(request: KeywordUploadRequest):
    """Upload or update a keyword list in the DB."""
    if not request.filename or not request.content.strip():
        raise HTTPException(status_code=400, detail="filename and content are required")
    try:
        result = upsert_keywords(request.filename, request.content, env=request.env)
        return {"status": "ok", **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/keywords/upload-file")
async def upload_keyword_file(file: UploadFile = File(...), env: str = "dev"):
    """Upload a .txt keyword file and store it in the DB."""
    if not file.filename or not file.filename.endswith(".txt"):
        raise HTTPException(status_code=400, detail="Only .txt files are accepted")
    try:
        content = (await file.read()).decode("utf-8")
        result = upsert_keywords(file.filename, content, env=env)
        return {"status": "ok", "filename": file.filename, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/keywords")
async def list_keywords_endpoint(env: str = "dev"):
    """List all keyword entries."""
    try:
        entries = list_keywords(env=env)
        return {"keywords": entries}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/keywords/{filename}")
async def delete_keywords(filename: str, env: str = "dev"):
    """Delete a keyword entry by filename."""
    try:
        result = remove_keywords(filename, env=env)
        return {"status": "ok", **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



class ProcessRequest(BaseModel):
    keepFields: list[str]
    uploadToConvex: bool = False
    environments: list[str] = ["dev"]


class JobStatus(BaseModel):
    status: str
    stats: dict[str, int] | None = None
    uploaded: dict[str, int] | None = None
    error: str | None = None


def detect_csv_fields(path: Path) -> list[str]:
    """Detect CSV header fields."""
    sep = detect_csv_separator(str(path))
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f, delimiter=sep)
        header = next(reader, None)
        if not header:
            return []
        return [str(h).strip() for h in header if str(h).strip()]


def detect_csv_sample_row(path: Path) -> dict[str, str]:
    """Get first non-empty data row from CSV."""
    sep = detect_csv_separator(str(path))
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter=sep)
        for row in reader:
            if not row:
                continue
            if any((str(v).strip() if v else "") for v in row.values()):
                return {str(k): ("" if v is None else str(v)) for k, v in row.items() if k}
        return {}


def count_csv_rows(path: Path) -> int:
    """Count data rows in CSV (excluding header)."""
    sep = detect_csv_separator(str(path))
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f, delimiter=sep)
        next(reader, None)  # Skip header
        return sum(1 for _ in reader)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok"}


class ScrapingTasksListResponse(BaseModel):
    tasks: list[dict[str, Any]]


@app.get("/scraping-tasks")
async def list_scraping_tasks(env: str = "dev", kind: str | None = None) -> ScrapingTasksListResponse:
    try:
        tasks = convex_query("workflowArtifacts:listUnimported", {"kind": kind} if kind is not None else {}, env=env)
        if not isinstance(tasks, list):
            tasks = []
        normalized = [normalize_task_row(task) for task in tasks if isinstance(task, dict)]
        return ScrapingTasksListResponse(tasks=normalized)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ImportScrapingTaskRequest(BaseModel):
    env: str = "dev"
    accountStatus: str = "available"


def _stringify_record(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    out: dict[str, str] = {}
    for k, v in value.items():
        if k is None:
            continue
        key = str(k)
        if not key:
            continue
        if v is None:
            out[key] = ""
        else:
            out[key] = str(v)
    return out


def _extract_fullname_from_user(user: Any) -> str:
    if not isinstance(user, dict):
        return ""
    for k in ["full_name", "fullName", "name"]:
        v = user.get(k)
        if v is None:
            continue
        s = str(v).strip()
        if s:
            return s
    return ""


def _extract_username_from_user(user):
    """Extract username string from a user dict or raw string."""
    if isinstance(user, dict):
        for key in ("userName", "username", "user_name", "login", "User Name"):
            v = user.get(key)
            if v:
                alias = str(v).strip()
                if alias:
                    return alias
        return ""
    if isinstance(user, str):
        return user.strip()
    return ""


def _build_scraping_archive_context(task: dict[str, Any]) -> dict[str, Any]:
    return {}


def _filter_and_collect_accounts(users, keyword_sets, archive_context: dict[str, Any] | None = None):
    """Filter deduped users and optionally build archival rows."""
    total_processed = 0
    removed = 0
    kept = []
    archived = []
    seen = set()
    now_ms = int(time.time() * 1000)

    for u in users:
        username = _extract_username_from_user(u)
        clean_username = username.lstrip("@").strip()
        if not clean_username:
            continue

        key = clean_username.lower()
        if key in seen:
            continue
        seen.add(key)
        total_processed += 1

        # Skip private accounts
        if isinstance(u, dict) and u.get("is_private") is True:
            removed += 1
            continue

        fullname = _extract_fullname_from_user(u)
        action, matched_name = filter_with_keywords(username, fullname, keyword_sets)

        entry = {"userName": clean_username}
        if fullname:
            entry["fullName"] = fullname
        if matched_name:
            entry["matchedName"] = matched_name

        if archive_context is not None:
            archived.append({
                "userName": clean_username,
                "status": "need_scraping",
                "createdAt": now_ms,
            })

        if action == "remove":
            removed += 1
            continue

        kept.append(entry)

    return kept, archived, total_processed, removed


def _deduplicate_accounts(accounts):
    """Deduplicate accounts by lowercased userName."""
    seen = set()
    unique = []
    for acc in accounts:
        key = acc["userName"].lower()
        if key not in seen:
            seen.add(key)
            unique.append(acc)
    return unique


def _upload_to_convex_envs(accounts, environments, status="available"):
    """Upload accounts to Convex for each environment, return (uploaded, duplicates)."""
    uploaded = {}
    duplicates = {}
    for out_env in environments:
        result = upload_accounts_to_convex(accounts, env=out_env, status=status)
        uploaded[out_env] = int(result.get("inserted", 0))
        duplicates[out_env] = int(result.get("skipped", 0))
    return uploaded, duplicates


def _archive_scraping_accounts(accounts, env: str) -> dict[str, int]:
    """Archive deduped scraping accounts into the scrapingAccounts table."""
    if not accounts:
        return {"inserted": 0, "skipped": 0}
    result = insert_scraping_accounts_batch(accounts, env=env)
    if result.get("status") != "success":
        raise RuntimeError(result.get("errorMessage", "Unknown error"))
    return {
        "inserted": int(result.get("inserted", 0)),
        "skipped": int(result.get("skipped", 0)),
    }


def _read_csv_as_user_dicts(input_path, sep):
    """Read CSV file and return list of row dicts for filtering."""
    import csv as _csv
    rows = []
    with input_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = _csv.DictReader(f, delimiter=sep)
        for row in reader:
            rows.append(row)
    return rows


def _fetch_storage_payload(storage_id: str, env: str) -> dict[str, Any]:
    url = convex_query("workflowArtifacts:getStorageUrl", {"storageId": storage_id}, env=env)
    if not url or not isinstance(url, str):
        raise HTTPException(status_code=400, detail=f"Could not get storage URL for {storage_id}")

    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    payload = resp.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail=f"Invalid task file payload for {storage_id}")
    return payload


def _load_manifest_payload(task: dict[str, Any], manifest_payload: dict[str, Any], env: str) -> dict[str, Any]:
    chunk_storage_ids = extract_chunk_storage_ids(manifest_payload, task)
    if not chunk_storage_ids:
        return build_manifest_payload(task, manifest_payload, [])

    chunk_payloads = [_fetch_storage_payload(storage_id, env) for storage_id in chunk_storage_ids]
    return build_manifest_payload(task, manifest_payload, chunk_payloads)


def _finalize_local_artifact_import(task_id: str, env: str, local_artifact_path: str | None) -> None:
    cleaned = str(local_artifact_path or "").strip()
    if not cleaned:
        convex_mutation("workflowArtifacts:setImported", {"id": task_id, "imported": True}, env=env)
        return

    file_path = _resolve_local_artifact_path(cleaned)
    if not file_path.exists():
        raise RuntimeError(f"Local artifact file not found: {cleaned}")

    backup = file_path.read_bytes()
    deleted_at = int(time.time() * 1000)
    file_path.unlink()
    try:
        convex_mutation(
            "workflowArtifacts:finalizeLocalImport",
            {"id": task_id, "imported": True, "deletedAt": deleted_at},
            env=env,
        )
    except Exception:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_bytes(backup)
        raise


def _get_task_and_payload(task_id: str, env: str) -> tuple[dict[str, Any], dict[str, Any]]:
    task = convex_query("workflowArtifacts:getById", {"id": task_id}, env=env)
    if not task or not isinstance(task, dict):
        raise HTTPException(status_code=404, detail="Task not found")
    normalized_task = normalize_task_row(task)

    local_artifact_path = str(task.get("localArtifactPath") or "").strip()
    if local_artifact_path:
        payload = _load_local_artifact_payload(local_artifact_path)
        payload.setdefault("storageKind", "local")
        payload.setdefault("localArtifactPath", local_artifact_path)
        return normalized_task, payload

    primary_storage_ids: list[str] = []
    seen_storage_ids: set[str] = set()
    for value in [
        task.get("exportStorageId"),
        task.get("storageId"),
        task.get("manifestStorageId"),
    ]:
        cleaned = str(value).strip() if value is not None else ""
        if cleaned and cleaned not in seen_storage_ids:
            seen_storage_ids.add(cleaned)
            primary_storage_ids.append(cleaned)

    primary_payload: dict[str, Any] | None = None
    for storage_id in primary_storage_ids:
        payload = _fetch_storage_payload(storage_id, env)
        if primary_payload is None:
            primary_payload = payload

        if has_user_collection(payload):
            payload["storageKind"] = "export"
            return normalized_task, payload

        export_storage_id = get_nested_storage_id(payload, EXPORT_STORAGE_ID_KEYS)
        if export_storage_id:
            export_payload = _fetch_storage_payload(export_storage_id, env)
            if has_user_collection(export_payload):
                export_payload["storageKind"] = "export"
                return normalized_task, export_payload

        chunk_storage_ids = extract_chunk_storage_ids(payload, task)
        if chunk_storage_ids or task.get("manifestStorageId") == storage_id:
            return normalized_task, _load_manifest_payload(task, payload, env)

    if primary_payload is not None and (task.get("manifestStorageId") or task.get("chunkRefs")):
        return normalized_task, _load_manifest_payload(task, primary_payload, env)

    if task.get("chunkRefs"):
        return normalized_task, _load_manifest_payload(task, {}, env)

    raise HTTPException(status_code=400, detail="Task has no readable storage payload")


class ScrapingTaskFieldsResponse(BaseModel):
    taskId: str
    env: str
    fields: list[str]
    sampleRow: dict[str, str]
    rowCount: int


@app.get("/scraping-tasks/{task_id}/fields")
async def get_scraping_task_fields(task_id: str, env: str = "dev") -> ScrapingTaskFieldsResponse:
    try:
        _, payload = _get_task_and_payload(task_id, env)
        users = extract_users_from_payload(payload)

        fields_set: set[str] = set()
        sample_user: Any = None
        for u in users[:200]:
            if sample_user is None and u is not None:
                sample_user = u
            if isinstance(u, dict):
                for k in u.keys():
                    if k is None:
                        continue
                    s = str(k).strip()
                    if s:
                        fields_set.add(s)
            elif isinstance(u, str):
                fields_set.add("userName")

        if not fields_set:
            fields_set.add("userName")

        if isinstance(sample_user, str):
            sample_row = {"userName": sample_user}
        else:
            sample_row = _stringify_record(sample_user)
            if not sample_row:
                sample_row = {"userName": ""}

        return ScrapingTaskFieldsResponse(
            taskId=task_id,
            env=env,
            fields=sorted(fields_set),
            sampleRow=sample_row,
            rowCount=len(users),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ProcessScrapingTaskRequest(BaseModel):
    env: str = "dev"
    keepFields: list[str]
    uploadToConvex: bool = True
    environments: list[str] = ["dev"]
    accountStatus: str = "available"


class DirectScrapeProcessRequest(BaseModel):
    workflowId: str
    workflowName: str
    nodeId: str
    nodeLabel: str | None = None
    kind: str
    targets: list[str] = []
    sourceProfileName: str | None = None
    users: list[Any]
    stats: dict[str, Any] = {}
    metadata: dict[str, Any] = {}
    env: str = "dev"
    environments: list[str] = ["dev"]
    accountStatus: str = "available"


@app.post("/scraping-tasks/{task_id}/process")
async def process_scraping_task(task_id: str, request: ProcessScrapingTaskRequest):
    try:
        env = request.env
        task, payload = _get_task_and_payload(task_id, env)
        if task.get("imported") is True and request.uploadToConvex:
            raise HTTPException(status_code=400, detail="Task already imported")

        keep_fields = [str(f).strip() for f in (request.keepFields or []) if str(f).strip()]
        if not keep_fields:
            raise HTTPException(status_code=400, detail="keepFields is required")

        users = payload.get("users")
        if not isinstance(users, list):
            users = extract_users_from_payload(payload)

        keyword_sets = load_all_keyword_sets(env=env)
        kept_accounts, archived_accounts, total_processed, removed = _filter_and_collect_accounts(
            users,
            keyword_sets,
            archive_context=_build_scraping_archive_context(task),
        )

        uploaded: dict[str, int] = {}
        duplicates: dict[str, int] = {}
        archive_result = _archive_scraping_accounts(archived_accounts, env=env)
        scraping_inserted = {env: int(archive_result.get("inserted", 0))}
        scraping_duplicates = {env: int(archive_result.get("skipped", 0))}

        if request.uploadToConvex:
            envs = [str(e).strip() for e in (request.environments or []) if str(e).strip()]
            if not envs:
                raise HTTPException(status_code=400, detail="environments is required when uploadToConvex is true")
            uploaded, duplicates = _upload_to_convex_envs(kept_accounts, envs, request.accountStatus)
            _finalize_local_artifact_import(task_id, env, task.get("localArtifactPath"))

        return {
            "status": "completed",
            "taskId": task_id,
            "env": env,
            "usernamesExtracted": len(kept_accounts),
            "stats": {
                "totalProcessed": total_processed,
                "removed": removed,
                "remaining": total_processed - removed,
            },
            "uploaded": uploaded,
            "duplicates": duplicates,
            "scrapingInserted": scraping_inserted,
            "scrapingDuplicates": scraping_duplicates,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/workflow-runs/process-scrape")
async def process_workflow_scrape(request: DirectScrapeProcessRequest):
    try:
        env = request.env
        users = request.users if isinstance(request.users, list) else None
        if users is None:
            raise HTTPException(status_code=400, detail="users must be an array")

        keyword_sets = load_all_keyword_sets(env=env)
        kept_accounts, _archived_accounts, total_processed, removed = _filter_and_collect_accounts(users, keyword_sets)

        envs = [str(item).strip() for item in (request.environments or []) if str(item).strip()]
        if not envs:
            raise HTTPException(status_code=400, detail="environments is required")

        uploaded, duplicates = _upload_to_convex_envs(
            kept_accounts,
            envs,
            request.accountStatus,
        )

        return {
            "status": "completed",
            "workflowId": request.workflowId,
            "nodeId": request.nodeId,
            "kind": request.kind,
            "stats": {
                "totalProcessed": total_processed,
                "removed": removed,
                "remaining": total_processed - removed,
            },
            "uploaded": uploaded,
            "duplicates": duplicates,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/scraping-tasks/{task_id}/import")
async def import_scraping_task(task_id: str, request: ImportScrapingTaskRequest):
    env = request.env
    try:
        task, payload = _get_task_and_payload(task_id, env)
        if task.get("imported") is True:
            raise HTTPException(status_code=400, detail="Task already imported")

        usernames = extract_usernames_from_scraping_task_payload(payload)
        result = upload_usernames_to_convex(usernames, env=env, status=request.accountStatus)

        convex_mutation("workflowArtifacts:setImported", {"id": task_id, "imported": True}, env=env)

        return {
            "taskId": task_id,
            "env": env,
            "usernamesExtracted": len(usernames),
            "inserted": result.get("inserted", 0),
            "skipped": result.get("skipped", 0),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/upload")
async def upload_csv(file: UploadFile = File(...)):
    """Upload a CSV file for processing.
    
    Returns job ID and detected fields.
    """
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted")
    
    job_id = str(uuid.uuid4())
    file_path = UPLOAD_DIR / f"{job_id}.csv"
    
    try:
        with file_path.open("wb") as f:
            shutil.copyfileobj(file.file, f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")
    
    # Detect fields and sample data
    try:
        fields = detect_csv_fields(file_path)
        sample_row = detect_csv_sample_row(file_path)
        row_count = count_csv_rows(file_path)
    except Exception as e:
        file_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"Failed to parse CSV: {e}")
    
    # Store job info
    jobs[job_id] = {
        "status": "uploaded",
        "fileName": file.filename,
        "filePath": str(file_path),
        "fields": fields,
        "sampleRow": sample_row,
        "rowCount": row_count,
    }
    
    return {
        "jobId": job_id,
        "fileName": file.filename,
        "fields": fields,
        "sampleRow": sample_row,
        "rowCount": row_count,
    }


@app.get("/upload/{job_id}/fields")
async def get_fields(job_id: str):
    """Get detected fields for an uploaded CSV."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = jobs[job_id]
    return {
        "fields": job["fields"],
        "sampleRow": job["sampleRow"],
        "rowCount": job["rowCount"],
    }


@app.post("/upload/{job_id}/process")
async def process_csv(job_id: str, request: ProcessRequest):
    """Process the uploaded CSV with filtering and optional upload."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = jobs[job_id]
    if job["status"] not in ["uploaded", "completed", "failed"]:
        raise HTTPException(status_code=400, detail="Job is already processing")
    
    input_path = Path(job["filePath"])
    if not input_path.exists():
        raise HTTPException(status_code=404, detail="Uploaded file not found")
    
    job["status"] = "processing"
    
    try:
        # Load keyword sets from DB for filtering
        keyword_sets = load_all_keyword_sets()

        # Read CSV rows and apply filtering
        sep = detect_csv_separator(str(input_path))
        csv_users = _read_csv_as_user_dicts(input_path, sep)
        kept_accounts, _archived_accounts, total_processed, removed_count = _filter_and_collect_accounts(csv_users, keyword_sets)

        stats = {
            "total_processed": total_processed,
            "removed": removed_count,
            "remaining": total_processed - removed_count,
        }
        job["stats"] = stats
        
        # Upload to Convex if requested
        uploaded = {}
        duplicates = {}
        if request.uploadToConvex and kept_accounts:
            uploaded, duplicates = _upload_to_convex_envs(kept_accounts, request.environments)
        
        job["uploaded"] = uploaded
        job["duplicates"] = duplicates
        job["status"] = "completed"
        
        return {
            "status": "completed",
            "stats": {
                "totalProcessed": stats.get("total_processed", 0),
                "removed": stats.get("removed", 0),
                "remaining": stats.get("remaining", 0),
            },
            "uploaded": uploaded,
            "duplicates": duplicates,
        }
        
    except HTTPException:
        raise
    except Exception as e:
        job["status"] = "failed"
        job["error"] = str(e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/upload/{job_id}/status")
async def get_status(job_id: str) -> JobStatus:
    """Get the status of a processing job."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = jobs[job_id]
    
    stats = None
    if "stats" in job:
        stats = {
            "totalProcessed": job["stats"].get("total_processed", 0),
            "removed": job["stats"].get("removed", 0),
            "remaining": job["stats"].get("remaining", 0),
        }
    
    return JobStatus(
        status=job["status"],
        stats=stats,
        uploaded=job.get("uploaded"),
        error=job.get("error"),
    )


@app.delete("/upload/{job_id}")
async def delete_job(job_id: str):
    """Delete a job and its associated files."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = jobs[job_id]
    
    # Clean up files
    for suffix in ["", "_filtered"]:
        file_path = UPLOAD_DIR / f"{job_id}{suffix}.csv"
        file_path.unlink(missing_ok=True)
    
    del jobs[job_id]
    
    return {"status": "deleted"}
