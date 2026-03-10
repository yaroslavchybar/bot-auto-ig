# Convex Backend Guide

## Purpose

`convex/` defines persistent data models, Clerk-authenticated browser-facing query/mutation modules, HTTP action routes for server/python interop, scheduled jobs, and one-off migration helpers.

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
- `auth.config.ts`

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
- Supports server/python interoperability for profile/list/account/template/scraping-task/workflow operations.
- Every HTTP action route requires `INTERNAL_API_KEY`.
- Missing `INTERNAL_API_KEY` is a configuration error and the HTTP surface fails closed rather than becoming public.

## Clerk Auth Model

- `convex/auth.ts` wraps browser-facing `query`, `mutation`, and `action` exports and requires a Clerk identity through `ctx.auth.getUserIdentity()`.
- Browser-accessed modules such as `lists`, `profiles`, `messageTemplates`, `scrapingTasks`, and `workflows` should use those wrappers for public functions.
- Server-only helpers should use `internalQuery`, `internalMutation`, or `internalAction`.
- Browser code should use the Convex React client with Clerk auth; it should not call Convex HTTP action routes directly.
- `convex/auth.config.ts` resolves Clerk issuer domain from `CLERK_JWT_ISSUER_DOMAIN` first, then falls back to publishable-key decoding for local/dev compatibility.

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
Keep `auth.config.ts` aligned with the active Clerk deployment domain so Convex and Clerk trust the same issuer.

## Local Verification

- `npm run test:convex` runs the isolated Convex self-test harness with `convex-test` + Vitest.
- The local suite covers the owned top-level `convex/*.ts` cohort and excludes `convex/_generated/*`.
- Tests must remain deterministic and local-only: no live Convex backend, no real outbound network calls, no deployed data writes.
- Any change under `convex/` must add or update relevant tests in `convex/tests/`.

## Verified Against

- `convex/convex.config.ts`
- `convex/schema.ts`
- `convex/http.ts`
- `convex/auth.ts`
- `convex/auth.config.ts`
- `convex/crons.ts`
- `convex/migrations.ts`
- `convex/lists.ts`
- `convex/profiles.ts`
- `convex/instagramAccounts.ts`
- `convex/messageTemplates.ts`
- `convex/keywords.ts`
- `convex/scrapingTasks.ts`
- `convex/workflows.ts`
