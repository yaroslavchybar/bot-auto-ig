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

### Convex Runtime
- `CLERK_JWT_ISSUER_DOMAIN` (preferred explicit Clerk issuer domain for Convex auth)
- `CLERK_PUBLISHABLE_KEY` (fallback source for deriving Clerk issuer domain)
- `VITE_CLERK_PUBLISHABLE_KEY` (local-dev fallback for issuer derivation only)

### Frontend Runtime / Build
- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_API_URL` (required for production frontend builds)
- `VITE_DATAUPLOADER_URL` (required for production frontend builds)
- `VITE_CONVEX_URL`

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
- Clerk React Router middleware + loaders enforce frontend route auth on the server render path.
- Browser-facing Convex functions require a Clerk identity through Convex auth integration.
- Convex HTTP action routes require `INTERNAL_API_KEY` and fail closed when the key is missing or invalid.
- Internal-key fallback only for selected server routes (`workflows`) using `INTERNAL_API_KEY`.
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
- `convex/auth.ts` browser-facing auth wrapper

## Verified Against

- `server/index.ts`
- `server/security/auth.ts`
- `server/security/rate-limit.ts`
- `server/websocket.ts`
- `frontend/src/lib/env.ts`
- `frontend/src/root.tsx`
- `frontend/src/hooks/useAuthenticatedFetch.ts`
- `frontend/src/features/accounts/hooks/useDataUploader.ts`
- `datauploader/convex_client.py`
- `python/database_sync/config.py`
