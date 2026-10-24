# Automation simplification

Automations execute routines directly, one profile at a time. Graph execution,
graph checkpoints, and the configurable worker pool are removed. Profile failures
still record their issue and allow other eligible profiles to run.

- `profiles.paused` is the persistent pause switch. Worker projections derive it.
- `profiles.modelId` holds the optional model assignment. Runtime pages use its index.
- `routine.outreach` holds the optional scraped list, profile selection, and message.
- Successful activity creates analytics history atomically, without opening Analytics.

## First deployment

Disable automations and stop browser profiles before deploying this change.
GitHub CI checks this before publishing Convex functions. It then deploys the
expanded schema, runs `migrations/simplifyAutomation:run`, and deploys the app.
No live migration was run during implementation.

If analytics has never been initialized, scraping must also be paused with no
requests running. This prevents old request buckets from racing the history backfill.
The checked production workspace already has initialized history.

The migration is bounded to 1,000 rows per affected table and runs atomically.
It refuses graph automations, multiple outreach assignments, and conflicting
profile memberships. Paused state wins when the old flags disagree. Existing
fingerprints, cookies, login, daily budgets, screening state, and initialized
analytics history are preserved. Repeating a completed migration does nothing.

For an uninitialized history, it seeds only surviving daily counters and existing
request buckets. Unavailable older history is not reconstructed.

## Cleanup after deployment

After CI confirms migration success on each used deployment, remove the one-time
migration, its preflight script and workflow calls, and its regression fixtures.
Then remove these schema-only compatibility fields: `profiles.modelIds`,
`accountProgress.paused`, `accountProgress.lastLeadListId`, automation graph fields,
and the old nested routine fields. Remove the empty `profileModelAssignments`
schema table and use `routineValidator` directly for stored routines.

These fields have no application readers or writers. They remain temporarily
optional so Convex can validate existing documents before the migration runs.
This follows Convex's [schema migration guidance](https://docs.convex.dev/database/schemas)
and keeps activity writes inside [atomic mutations](https://docs.convex.dev/functions/mutation-functions).
