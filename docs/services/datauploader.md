# Data Uploader Service

## Purpose

`datauploader/` provides CSV/task ingestion and upload flows for accounts data and keyword management.

## API Endpoints

- `GET /health`
- `GET /keywords`
- `POST /keywords/upload`
- `POST /keywords/upload-file`
- `DELETE /keywords/{filename}`

Scraping task import flow:
- `GET /scraping-tasks`
- `GET /scraping-tasks/{task_id}/fields`
- `POST /scraping-tasks/{task_id}/process`
- `POST /scraping-tasks/{task_id}/import`

Upload flow:
- `POST /upload`
- `GET /upload/{job_id}/fields`
- `POST /upload/{job_id}/process`
- `GET /upload/{job_id}/status`
- `DELETE /upload/{job_id}`

## Runtime Notes

- Stores uploaded files in `/app/uploads`.
- Uses in-memory job state for processing lifecycle.
- Reads and writes Convex data through `convex_client.py` helpers.

## Environment Variables

- `CONVEX_URL_DEV`
- `CONVEX_URL_PROD`
- `CONVEX_URL` (fallback)

## Verified Against

- `datauploader/api.py`
- `datauploader/uploader.py`
- `datauploader/convex_client.py`
- `datauploader/clean_data.py`
- `datauploader/filter_instagram.py`
