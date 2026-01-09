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
from filter_instagram import filter_csv
from uploader import upload_to_convex

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
    
    output_path = UPLOAD_DIR / f"{job_id}_filtered.csv"
    
    job["status"] = "processing"
    
    try:
        # Run filtering
        stats = filter_csv(input_path, output_path, keep_fields=request.keepFields)
        
        if stats is None:
            job["status"] = "failed"
            job["error"] = "Filtering failed"
            raise HTTPException(status_code=500, detail="Filtering failed")
        
        job["stats"] = stats
        
        # Upload to Convex if requested
        uploaded = {}
        duplicates = {}
        if request.uploadToConvex and output_path.exists():
            upload_results = upload_to_convex(output_path, request.environments)
            # Extract inserted counts and duplicate counts
            for env, result in upload_results.items():
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
