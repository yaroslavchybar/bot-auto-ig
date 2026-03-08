# Server Guide

## Purpose

The server exposes authenticated REST + WebSocket surfaces, orchestrates Python automation/scraping/workflow processes, and persists application state through Convex HTTP actions.

## Mounted Route Domains

Mounted under `/api/*`:
- `/api/automation`
- `/api/profiles`
- `/api/lists`
- `/api/logs`
- `/api/scraping`
- `/api/workflows`
- `/api/monitoring`
- `/api/displays`
- `/api/health` (public)

## Auth Model

- Clerk auth is applied globally.
- Most route groups require Clerk auth.
- `/api/workflows` allows Clerk auth OR `INTERNAL_API_KEY` bearer.

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
- Profile CRUD, browser launch/stop, runtime reconciliation, status sync, list assignment.
- Profile create/update requests normalize pasted cookie JSON before persistence, and `/api/profiles/by-id` returns the sensitive cookie field only for explicit detail fetches.
- List CRUD and bulk list assignment operations.

### Scraping
- Eligible profile discovery.
- Followers/following scraping (single/batch).
- Chunked scraping endpoints for resumable pagination.
- Scraping lifecycle events are emitted into the shared log stream with `source: scraper`, so they appear on the Logs page and in archived session logs.

### Workflows
- Run/stop workflow execution.
- Reports workflow status.
- Spawns `python/getting_started/run_workflow.py` and broadcasts workflow events.

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
- `SCRAPER_URL`
- `WORKFLOW_MAX_CONCURRENCY`
- `CONVEX_URL`
- `CLERK_SECRET_KEY`
- `INTERNAL_API_KEY`

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
- `server/api/scraping/index.ts`
- `server/api/scraping/followers.ts`
- `server/api/scraping/following.ts`
- `server/api/workflows.ts`
- `server/api/monitoring.ts`
- `server/api/displays.ts`
- `server/security/auth.ts`
- `server/security/rate-limit.ts`
- `server/websocket.ts`
