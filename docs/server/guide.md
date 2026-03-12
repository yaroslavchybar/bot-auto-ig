# Server Guide

## Purpose

The server exposes authenticated REST + WebSocket surfaces, orchestrates Python automation/workflow processes, and uses Convex as the shared data layer. Browser application data now reads and writes Convex directly with Clerk-authenticated tokens, while the server stays focused on orchestration, runtime control, monitoring, logs, and WebSocket delivery.

## Mounted Route Domains

Mounted under `/api/*`:
- `/api/automation`
- `/api/profiles`
- `/api/lists`
- `/api/logs`
- `/api/workflows`
- `/api/monitoring`
- `/api/displays`
- `/api/health` (public)

## Startup, CORS, and Auth Model

- Initializes the WebSocket server before listening.
- Cleans up orphaned Python processes left by previous runs.
- Reconciles stale profile runtime flags against the in-memory process registry before opening the HTTP listener.
- Clerk auth middleware is applied globally before protected route mounting.
- In development, CORS reflects the request origin or `*`.
- In production, CORS only allows origins listed in `ALLOWED_ORIGINS`.
- Most route groups require Clerk auth.
- `/api/workflows` allows Clerk auth or `INTERNAL_API_KEY` bearer.
- Internal server-to-Convex HTTP calls fail fast when `INTERNAL_API_KEY` is missing.

## Rate Limits

- General API limiter: 100 requests/minute.
- Automation limiter: 10 requests/minute.
- Write limiter utility available: 30 requests/minute.

## Route Group Behavior

### Automation
- Start/stop automation sessions.
- Trigger login automation.
- Exposes automation status.

### Profiles and Lists
- Runtime-only profile endpoints remain here: browser launch/stop, runtime reconciliation, status sync, and related operational control paths.
- Browser CRUD for profiles and lists now uses authenticated Convex client functions instead of Express list/detail CRUD routes.
- Profile detail reads that require the sensitive cookie field still remain explicit and do not surface through the cached list flow.

### Workflows
- Run/stop workflow execution.
- Reports workflow status.
- Spawns `python/runners/run_workflow.py` and broadcasts workflow events.
- Workflow definitions and editor data are read and written from the browser through authenticated Convex functions; Express handles execution and lifecycle control.
- Workflow scrape artifacts are exposed through `/api/workflows/artifacts` and `/api/workflows/artifacts/storage-url`.

### Monitoring and Displays
- System metrics endpoint for CPU/memory/disk/network/uptime.
- Active display sessions endpoint used by VNC view.

## WebSocket

- Path: `/ws`
- Requires Clerk token verification.
- Broadcasts logs and workflow/session/display events.

## Environment Variables

- `SERVER_PORT`
- `ALLOWED_ORIGINS`
- `NODE_ENV`
- `PYTHON`
- `WORKFLOW_MAX_CONCURRENCY`
- `CONVEX_URL`
- `CLERK_PUBLISHABLE_KEY` (server runtime; falls back to `VITE_CLERK_PUBLISHABLE_KEY` in local dev bootstrap)
- `CLERK_SECRET_KEY`
- `INTERNAL_API_KEY` (required anywhere the server calls Convex HTTP action routes)

## Commands

```bash
npm --prefix server run dev
npm --prefix server run build
npm --prefix server run start
```

## Verified Against

- `server/index.ts`
- `server/api/automation.ts`
- `server/api/profiles.ts`
- `server/api/lists.ts`
- `server/api/logs.ts`
- `server/api/workflows.ts`
- `server/api/monitoring.ts`
- `server/api/displays.ts`
- `server/automation/process-manager.ts`
- `server/data/profiles.ts`
- `server/data/convex.ts`
- `server/security/auth.ts`
- `server/security/rate-limit.ts`
- `server/websocket.ts`
