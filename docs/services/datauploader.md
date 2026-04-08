# Data Uploader Service

## Purpose

`datauploader/` provides CSV/workflow-artifact ingestion and upload flows for accounts data and keyword management.

## API Endpoints

- `GET /health`
- `GET /keywords`
- `POST /keywords/upload`
- `POST /keywords/upload-file`
- `DELETE /keywords/{filename}`

Workflow scrape artifact import flow:
- `GET /scraping-tasks` (`env`, optional `kind`)
- `GET /scraping-tasks/{task_id}/fields`
- `POST /scraping-tasks/{task_id}/process`
- `POST /scraping-tasks/{task_id}/import`

Legacy workflow runtime direct-ingest flow:
- `POST /workflow-runs/process-scrape`

Upload flow:
- `POST /upload`
- `GET /upload/{job_id}/fields`
- `POST /upload/{job_id}/process`
- `GET /upload/{job_id}/status`
- `DELETE /upload/{job_id}`

## Runtime Notes

- Stores uploaded files in `/app/uploads`.
- Workflow scrape tasks can load payloads from Convex storage exports or from host-shared local files referenced by `workflowArtifacts.localArtifactPath`.
- Uses in-memory job state for processing lifecycle.
- Upload jobs expose detected `fields`, `sampleRow`, and `rowCount` before processing.
- CSV and workflow-artifact processing responses include normalized `stats`, `uploaded`, and `duplicates` summaries.
- The `/scraping-tasks` API shape fronts completed workflow scrape artifacts queued for manual review. Successful processing archives the full deduped scrape into `scrapingAccounts`, uploads only accepted accounts to `instagramAccounts`, marks the artifact imported, and deletes the local raw file after that full sequence succeeds.
- `POST /workflow-runs/process-scrape` remains available as a legacy/internal direct-ingest surface, but workflow scraping now queues local artifacts instead of calling it during runtime completion.
- Reads and writes Convex data through `convex_client.py` helpers.

## Request Notes

- Scraping-task endpoints use `env` to select the source Convex environment.
- Processing endpoints accept `uploadToConvex` plus `environments` to control which destination Convex environments receive the filtered accounts.
- Manual scraping-task processing archives all deduped rows before filtering, then uploads only accepted accounts.
- Direct workflow processing accepts workflow/node metadata, scrape `kind`, source `targets`, in-memory `users`, runtime `stats`, `metadata`, source `env`, destination `environments`, and `accountStatus`.
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
