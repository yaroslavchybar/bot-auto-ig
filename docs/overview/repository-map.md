# Repository Map

## Top-Level Structure

- `frontend/`: React + Vite + TypeScript UI.
- `server/`: Express API + WebSocket + orchestration.
- `python/`: browser automation runtime and internals.
- `convex/`: schema/functions/http actions/crons.
- `datauploader/`: FastAPI CSV processing + Convex import service.
- `scraper/`: FastAPI + CLI scraping service.
- `data/`: runtime artifacts (logs/uploads).
- `docs/`: canonical documentation.

## Frontend Domain Map

Current tabs under `frontend/src/tabs/`:
- `profiles`
- `lists`
- `scraping`
- `workflows`
- `accounts`
- `logs`
- `vnc`
- `monitoring`

## Server Domain Map

Current route domains under `server/api/`:
- `automation`
- `profiles`
- `lists`
- `logs`
- `scraping`
- `workflows`
- `monitoring`
- `displays`

## Convex Domain Map

Primary modules under `convex/`:
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

## Verified Against

- `frontend/src/App.tsx`
- `server/index.ts`
- `convex/schema.ts`
- Directory listings for `server/api`, `frontend/src/tabs`, `convex/*.ts`
