# Convex Backend Guide

## Purpose

`convex/` defines persistent data models, app-level query/mutation modules, HTTP action routes for server/python interop, and scheduled jobs.

## Current Modules

- `schema.ts`
- `lists.ts`
- `profiles.ts`
- `instagramAccounts.ts`
- `messageTemplates.ts`
- `dashboard.ts`
- `keywords.ts`
- `scrapingTasks.ts`
- `workflows.ts`
- `http.ts`
- `crons.ts`

## Data Tables

From schema:
- `lists`
- `profiles`
- `instagramAccounts`
- `messageTemplates`
- `scrapingTasks`
- `workflows`
- `keywords`

## HTTP Actions

- Exposed under `/api/*` on `.convex.site` deployment host.
- Supports profile/list/account/template/scraping-task/workflow operations.
- Auth gate uses `INTERNAL_API_KEY` if configured.

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
```

Treat `convex/_generated/*` as generated artifacts.

## Verified Against

- `convex/schema.ts`
- `convex/http.ts`
- `convex/crons.ts`
- `convex/lists.ts`
- `convex/profiles.ts`
- `convex/instagramAccounts.ts`
- `convex/messageTemplates.ts`
- `convex/dashboard.ts`
- `convex/keywords.ts`
- `convex/scrapingTasks.ts`
- `convex/workflows.ts`
