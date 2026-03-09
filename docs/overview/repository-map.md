# Repository Map

## Top-Level Structure

- `frontend/`: React Router 7 + Vite frontend with route modules, feature-owned UI, and SSR/client entrypoints.
- `server/`: Express API, WebSocket server, automation orchestration, and Convex-backed data access.
- `python/`: browser automation runtime, workflow executor, and internal support systems.
- `convex/`: schema, query/mutation modules, HTTP actions, cron jobs, and migration helpers.
- `datauploader/`: FastAPI CSV and scraping-task ingest service.
- `scraper/`: FastAPI and CLI follower/following scraper service.
- `data/`: runtime artifacts such as logs and uploads.
- `docs/`: canonical documentation.

## Frontend Application Shape

Core app entrypoints under `frontend/src/`:
- `root.tsx`: document shell, Clerk provider, theme bootstrap, and top-level error boundary.
- `entry.client.tsx` / `entry.server.tsx`: React Router hydration and server rendering entrypoints.
- `routes.ts`: canonical route tree.
- `routes/*`: auth layout, protected layout, and per-path route modules.

Feature-owned domains under `frontend/src/features/`:
- `auth`
- `profiles`
- `lists`
- `scraping`
- `workflows`
- `accounts`
- `logs`
- `vnc`
- `monitoring`

Shared frontend layers:
- `components/ui`: design-system primitives.
- `components/layout`: authenticated shell, auth guard, theme toggle, Convex provider.
- `components/shared`: cross-feature composites such as auth shell, logs viewer, and error views.
- `hooks/` and `lib/`: app-wide runtime helpers and shared contracts.

## Server Application Shape

Mounted API route files under `server/api/`:
- `automation.ts`
- `profiles.ts`
- `lists.ts`
- `logs.ts`
- `scraping.ts` (compatibility re-export to `server/api/scraping/index.ts`)
- `workflows.ts`
- `monitoring.ts`
- `displays.ts`

Nested scraping router modules under `server/api/scraping/`:
- `index.ts`
- `followers.ts`
- `following.ts`
- `followers-chunk.ts`
- `following-chunk.ts`
- shared helpers, types, and logging modules under the same folder

Additional server surfaces:
- `automation/`: process runner, shutdown, and session state helpers.
- `data/`: Convex-backed profile, list, and message access.
- `security/`: Clerk auth and rate limiting.
- `websocket.ts`: live event transport for logs, workflow status, and display updates.

## Convex Surface

Primary owned modules under `convex/`:
- `schema.ts`
- `lists.ts`
- `profiles.ts`
- `instagramAccounts.ts`
- `messageTemplates.ts`
- `keywords.ts`
- `scrapingTasks.ts`
- `workflows.ts`
- `http.ts`
- `crons.ts`
- `migrations.ts`
- `convex.config.ts`

Generated artifacts:
- `convex/_generated/*`

## Verified Against

- `frontend/src/root.tsx`
- `frontend/src/routes.ts`
- `frontend/src/components/layout/ProtectedLayoutShell.tsx`
- directory listings for `frontend/src/features` and `frontend/src/routes`
- `server/index.ts`
- directory listings for `server/api` and `server/api/scraping`
- `convex/schema.ts`
- directory listing for `convex/*.ts`
