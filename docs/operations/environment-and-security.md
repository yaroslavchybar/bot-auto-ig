# Environment and Security

## Environment Files

- Use `.env` and `.env.local` for local configuration.
- Never commit secrets (Clerk keys, Convex keys, API credentials).

## Environment Variables in Use

### Server Runtime
- `SERVER_PORT`
- `ALLOWED_ORIGINS`
- `NODE_ENV`
- `PYTHON`
- `SCRAPER_URL`
- `WORKFLOW_MAX_CONCURRENCY`
- `CONVEX_URL`
- `CLERK_PUBLISHABLE_KEY` (or `VITE_CLERK_PUBLISHABLE_KEY` for local dev fallback)
- `CLERK_SECRET_KEY`
- `INTERNAL_API_KEY`

### Frontend Runtime / Build
- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_API_URL`
- `VITE_DATAUPLOADER_URL`
- `VITE_CONVEX_URL`
- `VITE_CONVEX_API_KEY`

### Data Services
- `CONVEX_URL_DEV`
- `CONVEX_URL_PROD`
- `CONVEX_URL` (fallback in datauploader)

### Python Runtime
- `FEED_DEBUG_MOUSE`
- `CONVEX_URL`
- `INTERNAL_API_KEY`
- additional Convex values loaded through `python/database_sync/config.py`

## Security Controls

- Clerk-authenticated API routes in server.
- Internal-key fallback only for selected routes (`workflows`) using `INTERNAL_API_KEY`.
- API rate limits:
  - general API: 100/min
  - automation routes: 10/min
  - write limiter available: 30/min
- WebSocket requires token verification via Clerk secret key.

## High-Risk Edit Areas

- `server/security/auth.ts`
- `server/security/rate-limit.ts`
- `server/index.ts` CORS + auth route mounting
- `server/websocket.ts`
- `convex/http.ts` auth gate for HTTP actions

## Verified Against

- `server/index.ts`
- `server/security/auth.ts`
- `server/security/rate-limit.ts`
- `server/websocket.ts`
- `frontend/src/lib/env.ts`
- `frontend/src/hooks/useAuthenticatedFetch.ts`
- `frontend/src/features/accounts/hooks/useDataUploader.ts`
- `datauploader/convex_client.py`
- `python/database_sync/config.py`
