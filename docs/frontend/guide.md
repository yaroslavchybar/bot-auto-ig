# Frontend Guide

## Purpose

The frontend is a Clerk-protected React + Vite operations app across profiles, lists, scraping, workflows, accounts upload, logs, VNC, and monitoring.

## Feature Surface

Primary tabs in app shell:
- Profiles Manager
- Lists Manager
- Scraping
- Workflows
- Upload Accounts
- Logs
- Browser View (VNC)
- VPS Monitor

Default landing tab:
- Profiles Manager

## Runtime Integration

### API Access
- Default API base for authenticated fetches: `VITE_API_URL` or `http://localhost:3001`.
- Most UI calls use backend routes under `/api/*`.
- Profiles create/edit flows support pasted cookie JSON, while the cached profile list remains sanitized and fetches the sensitive cookie payload only from explicit profile detail reads.

### WebSocket
- Default endpoint resolves from window host to `/ws`.
- Token appended as query parameter when available from Clerk.
- Handles event streams for logs, statuses, workflow progression, and display allocation.

### Data Uploader Integration
- Data uploader base: `VITE_DATAUPLOADER_URL` or:
  - dev: `http://localhost:3002`
  - prod: `/api/datauploader`

### Convex Integration
- Convex client consumes `VITE_CONVEX_URL` (with fallback env prefix support).
- Scraping tab may read storage URLs via Convex HTTP domain conversion logic.

## Workflow JSON Import/Export

Workflows tab supports:
- `Import JSON` from header actions.
- `Export JSON` from each workflow row action menu.

Export contract:
- Envelope shape:
  - `format: 'bot-auto-ig.workflow'`
  - `version: '1.0'`
  - `exportedAt` (ISO timestamp)
  - `workflow` with allowed fields only: `name`, `description`, `nodes`, `edges`
- Export never includes runtime metadata (`_id`, status, schedule, timestamps, etc).

Import contract and validation:
- Accepts `.json` files only.
- Max file size: `2MB` (`2097152` bytes).
- Max graph size: `nodes <= 500`, `edges <= 2000`.
- Requires valid envelope format/version and required `workflow` fields.
- Graph checks:
  - node IDs must be non-empty and unique
  - every edge `source`/`target` must reference an existing node ID
  - at least one start node (`type === 'start'` or `id === 'start_node'`)
- Unknown activity IDs (`getActivityById`) hard-fail and list offending IDs.
- `select_list.config.sourceLists` IDs missing from current lists are warning-only.
- Persistence is create-only (`api.workflows.create`), never overwrite existing workflows.
- Name collision auto-rename:
  - `"<name> (imported YYYY-MM-DD HH:mm)"`

## Environment Variables

- `VITE_CLERK_PUBLISHABLE_KEY` (required)
- `VITE_API_URL` (optional override)
- `VITE_DATAUPLOADER_URL` (optional override)
- `VITE_CONVEX_URL`
- `VITE_CONVEX_API_KEY` (used by scraping task artifact flow)

## Dev and Build

```bash
npm --prefix frontend run dev
npm --prefix frontend run build
npm --prefix frontend run lint
npm --prefix frontend run preview
```

## Verified Against

- `frontend/src/App.tsx`
- `frontend/src/main.tsx`
- `frontend/src/hooks/useAuthenticatedFetch.ts`
- `frontend/src/hooks/useWebSocket.ts`
- `frontend/src/tabs/accounts/useDataUploader.ts`
- `frontend/src/tabs/scraping/ScrapingPage.tsx`
- `frontend/src/tabs/workflows/WorkflowsPage.tsx`
- `frontend/src/tabs/workflows/WorkflowsList.tsx`
- `frontend/src/tabs/workflows/workflowImportExport.ts`
- `frontend/src/tabs/monitoring/MonitoringPage.tsx`
- `frontend/vite.config.ts`
