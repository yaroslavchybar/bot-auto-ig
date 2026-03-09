# Convex Backend Guide

## Purpose

`convex/` defines persistent data models, app-level query/mutation modules, HTTP action routes for server/python interop, scheduled jobs, and one-off migration helpers.

## Current Modules

- `convex.config.ts`
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

Generated artifacts:
- `_generated/*`

## Data Tables

From schema:
- `lists`
- `profiles` (includes optional `cookiesJson` for canonical browser cookie storage; omitted from list responses and exposed only on explicit profile detail reads)
- `instagramAccounts`
- `messageTemplates`
- `scrapingTasks`
- `workflows`
- `keywords`

## HTTP Actions

- Exposed under `/api/*` on `.convex.site` deployment host.
- Supports profile/list/account/template/scraping-task/workflow operations.
- Auth gate uses `INTERNAL_API_KEY` if configured.

## Migration Helpers

- `migrations.ts` contains cleanup and rollback mutations for the scraper-auto-only migration path.
- Treat migration helpers as operator tools, not as always-on runtime flows.

## Cron Jobs

Current daily jobs:
- reset daily scraping usage,
- auto unsubscribe,
- assign accounts,
- reset workflow daily runs.

## Development

```bash
npx convex dev
npx convex deploy
npm run test:convex
```

Treat `convex/_generated/*` as generated artifacts.
Keep `convex.config.ts` aligned with the owned module set and codegen expectations.

## Local Verification

- `npm run test:convex` runs the isolated Convex self-test harness with `convex-test` + Vitest.
- The local suite covers the owned top-level `convex/*.ts` cohort and excludes `convex/_generated/*`.
- Tests must remain deterministic and local-only: no live Convex backend, no real outbound network calls, no deployed data writes.
- Any change under `convex/` must add or update relevant tests in `convex/tests/`.

## Verified Against

- `convex/convex.config.ts`
- `convex/schema.ts`
- `convex/http.ts`
- `convex/crons.ts`
- `convex/migrations.ts`
- `convex/lists.ts`
- `convex/profiles.ts`
- `convex/instagramAccounts.ts`
- `convex/messageTemplates.ts`
- `convex/keywords.ts`
- `convex/scrapingTasks.ts`
- `convex/workflows.ts`
