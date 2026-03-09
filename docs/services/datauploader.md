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
- `GET /scraping-tasks` (`env`, optional `kind`)
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
- Upload jobs expose detected `fields`, `sampleRow`, and `rowCount` before processing.
- CSV and scraping-task processing responses include normalized `stats`, `uploaded`, and `duplicates` summaries.
- Scraping-task processing fetches task payloads from Convex storage URLs and marks the task as imported after successful upload/import.
- Reads and writes Convex data through `convex_client.py` helpers.

## Request Notes

- Scraping-task endpoints use `env` to select the source Convex environment.
- Processing endpoints accept `uploadToConvex` plus `environments` to control which destination Convex environments receive the filtered accounts.
- CSV upload accepts `.csv` files only; keyword file upload accepts `.txt` files only.

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
