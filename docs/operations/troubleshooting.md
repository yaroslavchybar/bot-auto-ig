# Troubleshooting

## Onboarding / Startup Failures

- `frontend` fails at startup with publishable key error:
  - verify `VITE_CLERK_PUBLISHABLE_KEY` is present.
- API/server returns Clerk publishable key errors during local `npm run dev`:
  - verify `.env` or `.env.local` contains `VITE_CLERK_PUBLISHABLE_KEY` or `CLERK_PUBLISHABLE_KEY`.
  - verify `CLERK_SECRET_KEY` is present for authenticated routes and WebSocket verification.
- API calls fail from frontend:
  - verify backend at `http://localhost:3001`.
  - verify `VITE_API_URL` overrides are intentional.
- `npm run dev:local` fails before opening processes:
  - verify `npm` is available on `PATH`.
  - verify Python 3.11+ is available through `.venv\Scripts\python.exe`, `python`, or `py`.
  - pass `-PythonPath C:\path\to\python.exe` to `dev-local.ps1` when the default resolution order is not correct.
- `npm run dev:local:tabs` or `.\dev-local.ps1 -UseTabs` fails:
  - verify Windows Terminal `wt.exe` is available on `PATH`.
- Data uploader actions fail:
  - verify `VITE_DATAUPLOADER_URL` in frontend, `DATAUPLOADER_URL` in the server/Python runtime, and `CONVEX_URL_DEV/PROD` in service env.

## Auth and Access Failures

- `401` on API routes:
  - verify Clerk token propagation and `CLERK_SECRET_KEY`.
- Convex query error `Unauthorized called by client`:
  - verify Clerk JWT template `convex` exists.
  - verify Convex auth issuer domain (`CLERK_JWT_ISSUER_DOMAIN`) matches the active Clerk Frontend API / issuer domain.
- Internal workflow calls rejected:
  - verify `INTERNAL_API_KEY` in both caller and server.

## Workflow and Scrape Node Issues

- Workflow run denied:
  - check `WORKFLOW_MAX_CONCURRENCY` cap.
- Workflow JSON import rejected (`Import accepts only .json files`):
  - rename/export using `.json` extension, then retry.
- Workflow JSON import rejected (`Invalid format` / `Unsupported version`):
  - ensure envelope uses `format: bot-auto-ig.workflow` and `version: 1.0`.
- Workflow JSON import rejected (`Unknown activity IDs: ...`):
  - open workflow editor and replace/remove unsupported activity nodes before export/import.
- Workflow JSON import rejected because of legacy `python_script` nodes:
  - remove the node from the workflow; custom Python execution was disabled for security reasons.
- Workflow JSON import warning (`Select List node references missing list IDs`):
  - import succeeds; create missing lists or remap `select_list.sourceLists` in the editor.
- Scrape workflow run denied:
  - verify the workflow includes `start_browser` and exactly one selected auth profile for `scrape_relationships`.
- Scrape node target failures:
  - inspect workflow details for scrape node state, retry metadata, and direct-processing history metadata; newer runs may not expose downloadable artifact or manifest payloads.

## Monitoring and VNC

- Monitoring panel errors:
  - verify `/api/monitoring` route and host metrics permissions.
- No active displays:
  - verify workflow/manual browser sessions emitted display allocation events.

## Python Runtime Problems

- Browser launch/proxy failures:
  - inspect `python/runners/launcher.py` and runtime logs.
- Frequent retries or aborts:
  - inspect error handling decisions in `python/internal_systems/error_handling`.
- Server automation or workflow routes cannot find Python runners after build/start mode changes:
  - verify the server is running from either the repo `server/` tree or the compiled `server/dist/` tree without extra path rewriting.
  - verify repo-root `python/` and `data/` directories still exist where the shared server resolver expects them.

## Docs Integrity Checks

```bash
git grep -n "file:///" -- "*.md" ":!docs/operations/troubleshooting.md" ":!docs/operations/verification-log.md"
```

Expected: no matches outside the docs pages that document this check.

## Verified Against

- `frontend/src/root.tsx`
- `frontend/src/lib/env.ts`
- `frontend/src/hooks/useAuthenticatedFetch.ts`
- `frontend/src/features/workflows/containers/WorkflowsPageContainer.tsx`
- `frontend/src/features/workflows/utils/workflowImportExport.ts`
- `frontend/src/features/monitoring/containers/MonitoringPageContainer.tsx`
- `server/api/workflows.ts`
- `server/api/monitoring.ts`
- `server/api/displays.ts`
- `python/runners/launcher.py`
- `python/runners/run_workflow.py`
