# Convex usage audit — September 24, 2026 (UTC)

## Scope and evidence

Production and development for IG auto bot. Read-only audit; no production deployment or VPS changes.

- Convex CLI: `insights --prod --json`, `insights --json`, read-only inline database queries, and `logs --history --success --jsonl`.
- CLI log retention covered only recent minutes. Full-day totals below come from Convex's official usage API, with the existing CLI login and the same query identifiers used by its open-source dashboard.
- Requested UTC interval: September 24 inclusive through September 25 exclusive. This is a snapshot collected around 20:56 UTC, before the day ended; usage reporting may lag.
- Reported total: 64,504 calls, 27,991,514 bytes database I/O, 131,468 bytes database storage, 79,774 bytes file storage, 1,076,949 bytes data egress, about 0.0114 GB-hours action compute. Search and AI gateway usage were zero.
- Function breakdown returned 82 rows and 64,264 calls. Separate usage queries can refresh at different times.
- Both deployments had no scrape jobs and no pending enrichment leads when checked. Empty scraper reads can be cached, but HTTP actions and claim mutations still execute.
- No production insights warnings. Development insights reported scraper write conflicts over the last **72 hours**, not necessarily on September 24. Recent logs suggest overlapping development polling workers; the audit did not stop or change running processes.

## Findings and local changes

The approach follows Convex's [best practices](https://docs.convex.dev/understanding/best-practices): use indexed reads, avoid clock-dependent subscription queries, and let database changes drive updates. Usage field definitions follow the [official dashboard source](https://github.com/get-convex/convex-backend/blob/main/npm-packages/dashboard/src/hooks/usageMetrics.ts).

| Area | Observed cost | Change / decision |
| --- | --- | --- |
| Scraper | 45,280 calls, approximately 70.2% of the day's total | Replace 10-second idle job/enrichment polling with an authenticated, indexed subscription. Use local timers for lease expiry, quota reset and cooldown; retry only while work exists. Atomic job claiming remains. |
| Profile maintenance | Profile list plus HTTP wrapper: 8,278 calls; maintenance ran every 30 seconds | Subscribe to indexed deletion/rename work. Fetch and retry only when maintenance exists; startup recovery remains. |
| Routine readiness | 1,806 reads plus 1,806 HTTP actions; 8,434,008 bytes read | Filter resting, paused, blocked, active and budget-exhausted accounts using the existing runtime subscription before requesting readiness/access. Server checks remain authoritative. Coalesce updates accumulated during sessions. |
| Runtime snapshot | 236 executions; 8,207,704 bytes read | Preserve bounded assignment paging and subscriptions. Include budget eligibility in the existing timing payload. Avoid triggering snapshots through unchanged profile writes. Actual profile and budget changes still require reads. |
| Profile cookie saves | 64 update mutations; 2,346,779 bytes read/write | Skip unchanged browser cookies; skip full name-uniqueness scans when the name is unchanged; skip unchanged database patches. Changed cookies are still persisted before browser cleanup. |
| Profile status | 64 status mutations; 531,260 bytes I/O | Avoid identical status writes and unnecessary subscription invalidation. |
| Background Chat | 315 production inbox checks, all with zero database reads because no Chat session existed | Subscribe to connected Chat account IDs. No profile/inbox requests when none are connected; keep 15-minute syncing for connected accounts. |
| Chat conversation/cache/session | Largest remaining development consumers | Reviewed current cache code: it already avoids unchanged histories/summaries and identical session serialization, coalesces requests, and backs off failures. Keep active conversation refresh at 20 seconds and inbox refresh at 60 seconds; hidden tabs skip these timers. |
| Frontend profile subscriptions | 102 executions across both deployments | Keep reactive subscriptions. Unchanged profile writes are now skipped upstream. |
| Routine reserve, follow cleanup, warmup begin/finish, session recording | 26 each in production | Retain: these reserve budgets, authorize work, record results and enforce recovery. No repeating idle loop found in these calls. |
| Automation lifecycle | Start/status/reconcile and scheduler reads | Retain required recovery and state transitions. Development had 48 reconciliations, consistent with server restarts during development. |
| Dashboard/system calls | Small database reads and manual patches | User/dashboard activity; no application polling to remove. |
| Storage, search, AI | Storage under 0.2 MB; search and AI zero | No cleanup or infrastructure changes justified by these totals. |

The two largest polling categories represent roughly 83% of reported calls, but profile-list calls also include legitimate startup/chat activity. This is an opportunity estimate, **not a measured post-deployment reduction**. Subscriptions still consume reads when dependencies change or deployments reconnect.

## Verification and rollout

- 100 Convex/Vitest tests and 48 relevant server tests passed.
- Tests cover empty queues, timestamp wakeups, cooldown and quota reset, expired leases, maintenance indexing, busy update coalescing, retries, no-session Chat idling, routine budget resets, and browser cleanup/cookie persistence.
- Deploy Convex functions/index first, then update and restart the application server. Existing production workers keep polling until replaced. No migration is needed for the added profile rename index.
- VPS access is read-only, so production rollout was not performed. No files staged or committed.
- Recheck a comparable UTC day after rollout, separating production from development and accounting for active sessions and restarts.

## Complete function inventory

Includes every row returned by the daily function usage query. HTTP wrapper calls and their nested queries/mutations are listed separately because Convex counts both. Bytes are unrounded. Zero-call system rows may still show database I/O.

| Function | Deployment | Calls | DB read bytes | DB write bytes | Action GB-hours | Egress bytes |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `/api/scraper/claim` | prod | 7381 | 0 | 0 | 0.00387877 | 0 |
| `scraper.js:claimNext` | prod | 7381 | 0 | 0 | 0.00000000 | 0 |
| `/api/scraper/pending` | prod | 7381 | 0 | 0 | 0.00153687 | 0 |
| `scraper.js:pendingLeads` | prod | 7381 | 0 | 0 | 0.00000000 | 0 |
| `/api/scraper/claim` | dev | 3939 | 0 | 0 | 0.00182977 | 0 |
| `scraper.js:claimNext` | dev | 3939 | 0 | 0 | 0.00000000 | 0 |
| `/api/scraper/pending` | dev | 3939 | 0 | 0 | 0.00057528 | 0 |
| `scraper.js:pendingLeads` | dev | 3939 | 0 | 0 | 0.00000000 | 0 |
| `profiles/queries.js:listInternal` | prod | 2506 | 1461817 | 0 | 0.00000000 | 0 |
| `/api/profiles` | prod | 2506 | 0 | 0 | 0.00057802 | 0 |
| `routines.js:access` | prod | 1878 | 1283192 | 0 | 0.00000000 | 0 |
| `routines.js:ready` | prod | 1806 | 8434008 | 0 | 0.00000000 | 0 |
| `/api/routines/ready` | prod | 1806 | 0 | 0 | 0.00100731 | 0 |
| `profiles/queries.js:listInternal` | dev | 1633 | 168756 | 0 | 0.00000000 | 0 |
| `/api/profiles` | dev | 1633 | 0 | 0 | 0.00023898 | 0 |
| `/api/chat/cache` | dev | 943 | 0 | 0 | 0.00032901 | 0 |
| `chatCache.js:inbox` | dev | 484 | 245525 | 0 | 0.00000000 | 0 |
| `chatCache.js:unreadCount` | dev | 336 | 225526 | 0 | 0.00000000 | 0 |
| `/api/chat/cache` | prod | 315 | 0 | 0 | 0.00004634 | 0 |
| `chatCache.js:inbox` | prod | 315 | 0 | 0 | 0.00000000 | 0 |
| `profiles/queries.js:getByIdInternal` | dev | 271 | 53839 | 0 | 0.00000000 | 0 |
| `/api/profiles/by-id` | dev | 271 | 0 | 0 | 0.00003786 | 0 |
| `/api/chat/session` | dev | 267 | 0 | 0 | 0.00112408 | 0 |
| `chatCache.js:conversation` | dev | 243 | 692341 | 0 | 0.00000000 | 0 |
| `automations/queries.js:runtimeSnapshot` | prod | 236 | 8207704 | 0 | 0.00000000 | 0 |
| `profiles/mutations.js:saveChatSessionInternal` | dev | 213 | 698626 | 91377 | 0.00000000 | 0 |
| `chatCache.js:saveConversation` | dev | 121 | 848914 | 295465 | 0.00000000 | 0 |
| `chatCache.js:saveInbox` | dev | 90 | 192689 | 38610 | 0.00000000 | 0 |
| `profiles/mutations.js:updateByNameInternal` | prod | 64 | 2167456 | 179323 | 0.00000000 | 0 |
| `profiles/mutations.js:syncStatusInternal` | prod | 64 | 347972 | 183288 | 0.00000000 | 0 |
| `profiles/queries.js:getByNameInternal` | prod | 64 | 105314 | 0 | 0.00000000 | 0 |
| `/api/profiles/update-by-name` | prod | 64 | 0 | 0 | 0.00006016 | 0 |
| `/api/profiles/sync-status` | prod | 64 | 0 | 0 | 0.00003922 | 0 |
| `/api/profiles/by-name` | prod | 64 | 0 | 0 | 0.00001523 | 0 |
| `profiles/queries.js:list` | dev | 57 | 110599 | 0 | 0.00000000 | 0 |
| `profiles/queries.js:getChatSessionInternal` | dev | 54 | 9504 | 0 | 0.00000000 | 0 |
| `automations/queries.js:listRoutinesForScheduler` | dev | 49 | 4056 | 0 | 0.00000000 | 0 |
| `/api/automations/reconcile` | dev | 48 | 0 | 0 | 0.00001901 | 0 |
| `automations/mutations.js:reconcileInterruptedInternal` | dev | 48 | 0 | 0 | 0.00000000 | 0 |
| `profiles/queries.js:list` | prod | 45 | 779047 | 0 | 0.00000000 | 0 |
| `profiles/mutations.js:setUnreadDmsInternal` | prod | 35 | 182342 | 41326 | 0.00000000 | 0 |
| `/api/profiles/unread-dms` | prod | 35 | 0 | 0 | 0.00001292 | 0 |
| `routines.js:recordSession` | prod | 26 | 109731 | 10218 | 0.00000000 | 0 |
| `routines.js:followTasks` | prod | 26 | 103195 | 0 | 0.00000000 | 0 |
| `routines.js:reserve` | prod | 26 | 103195 | 0 | 0.00000000 | 0 |
| `warmup/mutations.js:beginRunInternal` | prod | 26 | 96151 | 17794 | 0.00000000 | 0 |
| `warmup/mutations.js:finishRunInternal` | prod | 26 | 25942 | 15428 | 0.00000000 | 0 |
| `/api/routines/session` | prod | 26 | 0 | 0 | 0.00001889 | 0 |
| `/api/warmup/finish` | prod | 26 | 0 | 0 | 0.00001455 | 0 |
| `/api/routines/follow-tasks` | prod | 26 | 0 | 0 | 0.00001441 | 0 |
| `/api/warmup/begin` | prod | 26 | 0 | 0 | 0.00001434 | 0 |
| `/api/routines/reserve` | prod | 26 | 0 | 0 | 0.00001276 | 0 |
| `automations/queries.js:listRoutinesForScheduler` | prod | 20 | 8324 | 0 | 0.00000000 | 0 |
| `chatCache.js:unreadCount` | prod | 9 | 0 | 0 | 0.00000000 | 0 |
| `automations/mutations.js:updateStatusInternal` | prod | 8 | 12376 | 6232 | 0.00000000 | 0 |
| `chatCache.js:markUnsent` | dev | 4 | 41212 | 18697 | 0.00000000 | 0 |
| `chatCache.js:markReplied` | dev | 4 | 11627 | 5735 | 0.00000000 | 0 |
| `automations/mutations.js:startInternal` | prod | 4 | 6404 | 2964 | 0.00000000 | 0 |
| `automations/queries.js:getInternal` | prod | 4 | 2208 | 0 | 0.00000000 | 0 |
| `/api/automations/update-status` | prod | 4 | 0 | 0 | 0.00000222 | 0 |
| `/api/automations/start` | prod | 4 | 0 | 0 | 0.00000188 | 0 |
| `[unmatched]` | prod | 4 | 0 | 0 | 0.00000156 | 0 |
| `/api/automations/reconcile` | prod | 4 | 0 | 0 | 0.00000144 | 0 |
| `/api/automations/by-id` | prod | 4 | 0 | 0 | 0.00000087 | 0 |
| `automations/mutations.js:reconcileInterruptedInternal` | prod | 4 | 0 | 0 | 0.00000000 | 0 |
| `scraper.js:accounts` | prod | 2 | 51008 | 0 | 0.00000000 | 0 |
| `profiles/queries.js:getByIdInternal` | prod | 2 | 10494 | 0 | 0.00000000 | 0 |
| `leads.js:lists` | prod | 2 | 93 | 0 | 0.00000000 | 0 |
| `/api/chat/session` | prod | 2 | 0 | 0 | 0.00000040 | 0 |
| `/api/profiles/by-id` | prod | 2 | 0 | 0 | 0.00000043 | 0 |
| `profiles/queries.js:getChatSessionInternal` | prod | 2 | 0 | 0 | 0.00000000 | 0 |
| `scraper.js:jobs` | dev | 2 | 0 | 0 | 0.00000000 | 0 |
| `profiles/mutations.js:setIgState` | dev | 1 | 5104 | 2716 | 0.00000000 | 0 |
| `automations/queries.js:list` | dev | 1 | 338 | 0 | 0.00000000 | 0 |
| `proxies.js:list` | dev | 1 | 242 | 0 | 0.00000000 | 0 |
| `leads.js:lists` | dev | 1 | 93 | 0 | 0.00000000 | 0 |
| `leads.js:listPage` | dev | 1 | 0 | 0 | 0.00000000 | 0 |
| `_system/frontend/paginatedTableDocuments.js:default` | prod | 0 | 188661 | 0 | 0.00000000 | 0 |
| `_system/frontend/paginatedTableDocuments.js:default` | dev | 0 | 52059 | 0 | 0.00000000 | 0 |
| `_system/frontend/patchDocumentsFields.js:default` | prod | 0 | 17558 | 9241 | 0.00000000 | 0 |
| `_system/frontend/patchDocumentsFields.js:default` | dev | 0 | 5142 | 2716 | 0.00000000 | 0 |
| `_system/frontend/fileStorageV2.js:fileMetadata` | dev | 0 | 0 | 0 | 0.00000000 | 0 |
