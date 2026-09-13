# Simplification review — 2026-09-13

The main problem is duplicated state and contracts, followed by leftover support for older designs. The React + Express + Convex split itself is reasonable: UI, browser orchestration, and persistent data have different jobs.

This is a local source review of frontend, server, Convex, tests, and deployment configuration. Caller searches establish usage inside this repository, not usage by outside scripts. No production inspection or app behavior changes were made. The list is a prioritized set of supported findings, not a guarantee that every possible simplification has been found.

1. **Remove the extra frontend database caches. High priority.**

   [useProfiles](../frontend/src/features/profiles/hooks/useProfiles.ts) and [useLists](../frontend/src/features/lists/hooks/useLists.ts) combine a live Convex query, a separate manual query, copied React state, localStorage, and refresh effects. List mutations then explicitly refresh again. Let the live query own server data; derive the display shape and loading state directly. Keep local state for unsaved forms and selection. Remove the cache and refresh plumbing unless offline snapshots become a real requirement.

   There is already a correctness consequence in [useWorkflowsPage](../frontend/src/features/workflows/hooks/useWorkflowsPage.ts): `overrideData ?? workflows` permanently prefers the manual refresh result after Refresh is clicked. Later live updates are hidden until remount. Remove that override and the artificial 400 ms refresh delay.

2. **Give live logs one buffer. High priority.**

   [useWebSocket](../frontend/src/hooks/useWebSocket.ts) buffers logs, while [useLogsState](../frontend/src/components/shared/useLogsState.ts) copies them into another buffer, deduplicates them, and tracks progress by array length. Once the WebSocket buffer reaches capacity, its length stays constant and `wsLogs.slice(processedRef.current)` returns nothing. New entries stop reaching the viewer.

   Let one hook own the bounded log buffer, receiving initial history and incoming events. Give entries stable server identifiers if history/live overlap must be deduplicated. Remove the permanently `'live'` mode, `switchToLive` plumbing, and artificial refresh delay. Preserve history loading, filtering, bounded memory, and reconnect handling.

3. **Retire the second automation execution path. High priority; confirm outside callers before removal.**

   [automation/routes](../server/automation/routes.ts) implements global start/stop/status and its own spawning, event wiring, and cleanup. [workflows/service](../server/workflows/service.ts) implements the workflow version. [worker](../server/automation/worker.ts) supports both settings-based and graph-based execution. No frontend callers of global automation start/stop/status were found; the login route is still used.

   Keep workflow execution as the single run model. Move login to the profile area, then remove the old global runner branch, its settings-only validation, global status broadcasts, PID facade, and separate state persistence where no longer needed. Retain settings/defaults actually consumed by current workflow actions. Preserve process-tree termination and startup reconciliation for interrupted workflow runs.

4. **Remove duplicate CRUD routes. High priority.**

   Lists have direct Convex mutations, [Express CRUD routes](../server/lists/routes.ts), and [Convex HTTP CRUD routes](../convex/httpRoutes/lists.ts), including both `/remove` and `/delete` aliases. The frontend already uses Convex directly for list CRUD.

   Keep one public app path for each data operation. Delete unused Express forwarding routes and unused HTTP mutations after checking outside callers. Keep the list reads needed by workers. Keep Express operations that actually coordinate browser processes or local files; profile creation/deletion is not automatically equivalent to ordinary database CRUD.

5. **Use one internal data shape. High priority.**

   Profiles are converted from Convex camelCase into snake_case HTTP rows, then into another server/frontend profile type. Compare [HTTP mapping](../convex/httpRoutes/shared.ts), [server client types](../server/shared/convexClient.ts), [server profile mapping](../server/profiles/data.ts), and [frontend profile mapping](../frontend/src/features/profiles/utils/mapProfile.ts). Even the same flag becomes `using`, `Using`, and `using` again.

   Use generated Convex types or a small explicit projection with the same names. Keep a separate safe UI projection that excludes cookies and other session secrets. Normalize third-party input at entry points, not repeatedly between code we own. Apply the same rule to worker/WebSocket events: one typed event union instead of both `workflow_id` and `workflowId`, `node_states` and `nodeStates`, etc.

6. **Trim the HTTP adapter without removing its access boundary. Medium priority.**

   [convexClient](../server/shared/convexClient.ts) and [httpRoutes](../convex/httpRoutes/shared.ts) maintain hand-written endpoint contracts and broad `any` payloads. Keep a narrow authenticated bridge for worker operations; consolidate types and remove unused endpoints. A transport replacement is a separate decision, not necessary for the first cleanup.

   Error status currently depends on matching English phrases such as “required” and “already running.” Return explicit error codes and map them once at the HTTP boundary. Keep runtime input validation and deliberate retry behavior; do not expose internal mutations simply to shorten the client.

7. **Choose one artifact storage format. High payoff; migration decision.**

   The current [scraper](../server/automation/scrape.ts) writes local chunks and checkpoints. The [schema](../convex/schema.ts), [artifact queries](../convex/workflowArtifacts.ts), [download routes](../server/workflows/routes.ts), and [frontend download target](../frontend/src/lib/artifact-download.ts) still support local paths plus `storageId`, `manifestStorageId`, and `exportStorageId`. The stream reader also accepts the older whole-file format.

   If local chunks are the intended storage, migrate any wanted older artifacts and remove the unused cloud-storage branches and old format fallback. Use workflow ID + artifact ID for downloads. Preserve atomic checkpoints, immutable chunks, streaming, and path checks. No users does not mean existing scraped data should be discarded automatically.

8. **Flatten page plumbing. Medium priority.**

   Several pages are only wrappers around containers, which then unpack and forward large hook return objects. [ProfilesPage](../frontend/src/features/profiles/ProfilesPage.tsx) is one example. [useWorkflowsPage](../frontend/src/features/workflows/hooks/useWorkflowsPage.ts) further splits simple dialog setters and mutations into several hooks, then recombines them.

   Merge pass-through pages and containers. Keep reusable UI components and hooks with their own meaningful lifecycle, such as subscriptions and import validation. Ordinary event handlers can live with the page that uses them. Avoid replacing this structure with a generic CRUD framework.

9. **Store selected node identity, not another node copy. Medium priority.**

   [useFlowEditorState](../frontend/src/features/workflows/hooks/useFlowEditorState.ts) maintains `selectedNode` alongside ReactFlow nodes. Insert, update, duplicate, delete, and restore paths must update both. Derive the selected node from ReactFlow selection, or keep only `selectedNodeId` and look it up. Preserve draft graph state and undo behavior; those serve real editing needs.

10. **Reduce activity registry bookkeeping. Medium priority.**

    Activity metadata is split between individual definitions and the large `ACTIVITY_METADATA` overlay in [activities/index](../frontend/src/features/workflows/activities/index.ts). Every definition also declares a `handler` string, but no runtime reader of that property was found; the worker dispatches by activity ID.

    Put picker metadata with each definition and remove the unused handler field. Define shared activity IDs/config types for the editor and worker. Keep the data-driven input renderer: multiple activities reuse those field types, so that abstraction earns its place.

11. **Remove internal compatibility aliases. Medium priority.**

    [Workflow routes](../server/workflows/routes.ts) accept three spellings of workflow ID and parallelism. [Activity normalization](../frontend/src/features/workflows/activities/index.ts) migrates old cooldown keys on every read. [selectedLists](../server/automation/graph.ts) falls back to list configuration on an older start-node shape, while the current start node has no data.

    Normalize any retained workflows once, update owned callers together, and delete old representations. Do not confuse these with useful external formats: proxy syntax and imported browser cookie formats may still need multiple parsers.

12. **Simplify scheduling ownership. Medium priority.**

    [Scheduled execution](../convex/workflows/scheduling.ts) and [manual start](../convex/workflows/mutations.ts) duplicate quota checks, counter increments, and run-state initialization. Both reset daily counters on demand, while a daily cron resets them again.

    Put shared run preparation in one transactional helper. Keep either on-demand day-based accounting or scheduled reset with clearly defined reads. Separate “Run now” from “enable recurring schedule”; treating instant execution as a persistent active schedule creates avoidable special cases. Preserve duplicate-start prevention, daily limits, and durable scheduling.

13. **Remove unused schema promises. Low risk after checking retained data.**

    `scrapeLeaseOwner`, `scrapeLeaseExpiresAt`, `scrapeHealth`, and `lastScrapeFailureAt` appear in the [schema](../convex/schema.ts), initial defaults, and API mappings, but no active lease/health algorithm was found. `scheduledAt` is writable and indexed, but no scheduler consumer was found. Remove dormant fields, mappings, and indexes rather than implying these features exist. Keep actual quota accounting and browser/profile ownership protection.

14. **Simplify route and session plumbing. Medium priority, partly optional.**

    [App](../frontend/src/App.tsx) and [ProtectedLayoutShell](../frontend/src/components/layout/ProtectedLayoutShell.tsx) both apply `AuthGuard`. The shell also keeps route elements in a module-global cache. Routes are separately described in [router metadata](../frontend/src/lib/router.tsx) and the rendering switch.

    Keep one auth gate and one route definition table. Prefer ordinary mounting with deliberate persistence of filters/selection. If retaining whole pages is required, scope that cache to the signed-in layout. The small custom router is not itself a reason for a rewrite; consolidating its definitions is enough initially.

15. **Delete unused auth APIs and wrappers. Low effort.**

    [useAuthenticatedFetch](../frontend/src/hooks/useAuthenticatedFetch.ts) is called only for its token-registration effect; its returned request wrapper has no caller. Register the token getter in the auth owner and remove the unused body-normalizing wrapper.

    The older `loginWithTelegram` widget flow remains in [auth](../frontend/src/lib/auth.tsx) and [server routes](../server/auth/routes.ts), but the current login screen uses deep links and token polling. If no outside caller needs widget login, remove that branch. Keep token expiry, single-use login tokens, webhook verification, admin checks, and session validation.

16. **Remove structural test and build duplication. Low priority.**

    [moduleInventory.test](../tests/convex/moduleInventory.test.ts) and [inventory.test](../tests/convex/inventory.test.ts) assert exact source-file lists. They make harmless file moves require test edits without checking behavior. Remove them or replace the underlying coverage requirement with behavior coverage.

    [Server Dockerfile](../server/Dockerfile) installs the same production dependencies in `browser-deps` and its descendant `bun-runtime-deps`. Collapse that duplicate stage while retaining separate build/runtime dependencies and cached browser installation. Environment loading is also duplicated in [env](../server/env.ts) and [convexClient](../server/shared/convexClient.ts); load configuration once per executable entry point with one root-path rule.

The complexity worth keeping is browser subprocess isolation and process-tree cleanup; cross-process browser capacity and cancellation; profile-session persistence; display allocation and VNC visibility/backoff; graph branching and failure edges; durable scheduling and valid status transitions; idempotent quota commits; atomic scrape checkpoints and streamed exports; authentication, boundary validation, and path containment. These address real failure modes. Keep the small pool and latest-update queue too: they already solve bounded problems directly.

Suggested order: fix findings 1–2, remove confirmed unused paths and aliases, unify contracts, then flatten UI plumbing. Storage migration and route caching deserve explicit product decisions before behavior is removed. Do not attempt a whole-app rewrite.

Verification: repository caller searches and source tracing; small standalone JavaScript reproductions confirmed the refresh override and full-buffer arithmetic. These were not mounted React/browser tests. No test suite was run because this change only adds the review document.
