# Troubleshooting

## Onboarding / Startup Failures

- `frontend` fails at startup with publishable key error:
  - verify `VITE_CLERK_PUBLISHABLE_KEY` is present.
- API calls fail from frontend:
  - verify backend at `http://localhost:3001`.
  - verify `VITE_API_URL` overrides are intentional.
- Data uploader actions fail:
  - verify `VITE_DATAUPLOADER_URL` in frontend and `CONVEX_URL_DEV/PROD` in service env.

## Auth and Access Failures

- `401` on API routes:
  - verify Clerk token propagation and `CLERK_SECRET_KEY`.
- Internal workflow calls rejected:
  - verify `INTERNAL_API_KEY` in both caller and server.

## Workflow and Scraping Issues

- Workflow run denied:
  - check `WORKFLOW_MAX_CONCURRENCY` cap.
- No eligible scraping profiles:
  - verify profile login/runtime/list assignment state.
- Scraping target failures:
  - inspect `/api/scraping/*` responses and task output payloads.

## Monitoring and VNC

- Monitoring panel errors:
  - verify `/api/monitoring` route and host metrics permissions.
- No active displays:
  - verify workflow/manual browser sessions emitted display allocation events.

## Python Runtime Problems

- Browser launch/proxy failures:
  - inspect `python/getting_started/launcher.py` and runtime logs.
- Frequent retries or aborts:
  - inspect error handling decisions in `python/internal_systems/error_handling`.

## Docs Integrity Checks

```bash
git grep -n "file:///" -- "*.md"
```

Expected: no matches.

## Verified Against

- `frontend/src/main.tsx`
- `frontend/src/hooks/useAuthenticatedFetch.ts`
- `frontend/src/tabs/scraping/ScrapingPage.tsx`
- `frontend/src/tabs/monitoring/MonitoringPage.tsx`
- `server/api/scraping/*`
- `server/api/workflows.ts`
- `server/api/monitoring.ts`
- `server/api/displays.ts`
- `python/getting_started/launcher.py`
