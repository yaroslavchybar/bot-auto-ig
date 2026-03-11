"""FastAPI REST API for CSV data upload and processing."""

import csv
import shutil
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from clean_data import detect_csv_separator
from filter_instagram import filter_csv, filter_with_keywords, load_all_keyword_sets
from convex_client import convex_mutation, convex_query, get_keywords, upsert_keywords, list_keywords, remove_keywords
from scraping_tasks import (
    EXPORT_STORAGE_ID_KEYS,
    build_manifest_payload,
    extract_chunk_storage_ids,
    extract_users_from_payload,
    get_nested_storage_id,
    has_user_collection,
    normalize_task_row,
)
from uploader import extract_usernames_from_scraping_task_payload, upload_to_convex, upload_usernames_to_convex, upload_accounts_to_convex

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
        tasks = convex_query("scrapingTasks:listUnimported", {"kind": kind} if kind is not None else {}, env=env)
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


def _fetch_storage_payload(storage_id: str, env: str) -> dict[str, Any]:
    url = convex_query("scrapingTasks:getStorageUrl", {"storageId": storage_id}, env=env)
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


def _get_task_and_payload(task_id: str, env: str) -> tuple[dict[str, Any], dict[str, Any]]:
    task = convex_query("scrapingTasks:getById", {"id": task_id}, env=env)
    if not task or not isinstance(task, dict):
        raise HTTPException(status_code=404, detail="Task not found")
    normalized_task = normalize_task_row(task)

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

        # Load keyword sets from DB for filtering
        keyword_sets = load_all_keyword_sets(env=env)

        total_processed = 0
        removed = 0
        kept_accounts: list[dict[str, Any]] = []
        for u in users:
            total_processed += 1
            username = ""
            if isinstance(u, dict):
                v = u.get("userName") or u.get("username") or u.get("user_name") or u.get("login") or u.get("User Name")
                if v is not None:
                    username = str(v).strip()
            elif isinstance(u, str):
                username = u.strip()

            fullname = _extract_fullname_from_user(u)
            action, matched_name = filter_with_keywords(username, fullname, keyword_sets)
            if action == "remove":
                removed += 1
                continue

            # Build account entry with metadata
            clean_username = username.lstrip("@").strip()
            if not clean_username:
                continue
            account_entry: dict[str, Any] = {"userName": clean_username}
            if fullname:
                account_entry["fullName"] = fullname
            if matched_name:
                account_entry["matchedName"] = matched_name
            kept_accounts.append(account_entry)

        # Deduplicate
        seen: set[str] = set()
        unique_accounts: list[dict[str, Any]] = []
        for acc in kept_accounts:
            key = acc["userName"].lower()
            if key not in seen:
                seen.add(key)
                unique_accounts.append(acc)

        uploaded: dict[str, int] = {}
        duplicates: dict[str, int] = {}

        if request.uploadToConvex:
            envs = [str(e).strip() for e in (request.environments or []) if str(e).strip()]
            if not envs:
                raise HTTPException(status_code=400, detail="environments is required when uploadToConvex is true")
            for out_env in envs:
                result = upload_accounts_to_convex(unique_accounts, env=out_env, status=request.accountStatus)
                uploaded[out_env] = int(result.get("inserted", 0))
                duplicates[out_env] = int(result.get("skipped", 0))
            convex_mutation("scrapingTasks:setImported", {"id": task_id, "imported": True}, env=env)

        return {
            "status": "completed",
            "taskId": task_id,
            "env": env,
            "usernamesExtracted": len(unique_accounts),
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

        convex_mutation("scrapingTasks:setImported", {"id": task_id, "imported": True}, env=env)

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

        # Read CSV and apply filtering inline to capture fullName + matchedName
        sep = detect_csv_separator(str(input_path))
        total_processed = 0
        removed_count = 0
        kept_accounts: list[dict[str, Any]] = []
        seen: set[str] = set()

        with input_path.open("r", encoding="utf-8-sig", newline="") as f:
            import csv as _csv
            reader = _csv.DictReader(f, delimiter=sep)
            username_aliases = ["user_name", "userName", "username", "login", "User Name"]
            fullname_aliases = ["full_name", "fullName", "name"]

            for row in reader:
                total_processed += 1

                # Extract username
                username = ""
                for alias in username_aliases:
                    v = row.get(alias)
                    if v and str(v).strip():
                        username = str(v).strip().lstrip("@")
                        break

                # Extract fullname
                fullname = ""
                for alias in fullname_aliases:
                    v = row.get(alias)
                    if v and str(v).strip():
                        fullname = str(v).strip()
                        break

                if not username:
                    removed_count += 1
                    continue

                # Apply filtering
                action, matched_name = filter_with_keywords(username, fullname, keyword_sets)
                if action == "remove":
                    removed_count += 1
                    continue

                # Deduplicate
                key = username.lower()
                if key in seen:
                    continue
                seen.add(key)

                account_entry: dict[str, Any] = {"userName": username}
                if fullname:
                    account_entry["fullName"] = fullname
                if matched_name:
                    account_entry["matchedName"] = matched_name
                kept_accounts.append(account_entry)

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
            for env in request.environments:
                result = upload_accounts_to_convex(kept_accounts, env=env)
                uploaded[env] = result.get("inserted", 0)
                duplicates[env] = result.get("skipped", 0)
        
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
