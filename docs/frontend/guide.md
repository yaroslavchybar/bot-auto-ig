# Frontend Guide

## Purpose

The frontend is a Clerk-protected React + Vite dashboard for operations across profiles, lists, scraping, workflows, accounts upload, logs, VNC, and monitoring.

## Feature Surface

Primary tabs in app shell:
- Dashboard
- Profiles Manager
- Lists Manager
- Scraping
- Workflows
- Upload Accounts
- Logs
- Browser View (VNC)
- VPS Monitor

## Runtime Integration

### API Access
- Default API base for authenticated fetches: `VITE_API_URL` or `http://localhost:3001`.
- Most UI calls use backend routes under `/api/*`.

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
- `frontend/src/tabs/monitoring/MonitoringPage.tsx`
- `frontend/vite.config.ts`
