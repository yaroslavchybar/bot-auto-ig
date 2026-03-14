# Architecture

Architectural decisions, patterns discovered, and DDD structure conventions.

**What belongs here:** Architectural patterns, module organization rules, DDD conventions.

---

## Target DDD Structure

### Server (Express)
```
server/
├── profiles/          # Profile routes, services, data access
├── workflows/         # Workflow routes, services, data access
├── automation/        # Automation routes, process management
├── monitoring/        # Monitoring routes
├── lists/             # Lists routes, data access
├── logs/              # Logs routes, parsing, storage
├── displays/          # Display routes
├── shared/            # Cross-cutting: logger, errors, ProcessService, store, mutex, utils
├── security/          # Auth middleware, rate limiting
├── websocket.ts       # WebSocket server
└── index.ts           # App bootstrap
```

### Canonical Shared Server Modules
- `server/shared/convexClient.ts` is the canonical Convex HTTP client path; the old `server/data/convex.ts` path is deleted.
- `server/shared/store.ts` is the only shared state module. All server domains should import `clients`, `logsStore`, `automationState`, `workflowWorkers`, `activeDisplays`, and `profileProcesses` from this path.
- Shared cross-cutting utilities now live under `server/shared/`, including `ProcessService.ts`, `types.ts`, `settings-schema.ts`, `user-agents.ts`, `mutex.ts`, `logger.ts`, and `errors.ts`.
- Route admission checks that read and mutate `automationState` or `workflowWorkers` must stay inside `automationMutex` critical sections; moving those checks ahead of `acquire()` can reintroduce duplicate-start and stop races.

### Python
```
python/
├── runners/           # Entry points and orchestration
│   ├── workflow/      # Workflow runner
│   └── multi_account/ # Multi-account runner
├── actions/           # Instagram domain actions
│   ├── engagement/    # Follow, unfollow, approve
│   ├── messaging/     # DM automation
│   └── stories/       # Story viewing
├── browser/           # Browser lifecycle (Camoufox, context, cookies)
├── database/          # Convex client adapters
├── core/              # Infrastructure (logging, errors, config, storage)
└── tests/
```

- The server launches workflow subprocesses through `python/runners/run_workflow.py`; that wrapper then calls into `python.runners.workflow.entrypoint.main()`.

### Convex Module Split Notes
- Splitting a top-level Convex module into a directory changes generated `api.*` and `internal.*` paths. Example: `api.profiles.list` becomes `api.profiles.queries.list`, and `api.workflows.create` becomes `api.workflows.mutations.create`.
- `tests/convex/moduleInventory.test.ts` inventories only top-level `convex/*.ts` entries, while `tests/convex/inventory.test.ts` inventories the full `convex/**/*.ts` tree.
- Many Convex domain helpers still signal validation or conflict cases via plain `Error` message strings. Shared HTTP wrappers must preserve a central 4xx mapping for those messages or convert them to typed errors before responding.
- Repository tracking is uneven under `tests/convex/`: `.gitignore` ignores `tests/`, but some Convex tests are force-tracked while others on disk remain untracked. When editing a currently untracked Convex test, workers must use `git add -f tests/convex/<file>` or the change will stay out of the commit.

### Import Direction Rules
- Server: routes → services → data access (never reverse)
- Python: runners → actions → (core|browser), runners → database → core
- No circular imports allowed

## Frontend Refactor Gotchas
- `frontend/src/components/layout/ProtectedLayoutShell.tsx` keeps `/workflows`, `/accounts`, `/logs`, and `/vnc` mounted through `keepAliveCache` + React `Activity` even when those pages are hidden. Polling hooks, timers, and global toasts in those pages continue running unless they also gate on route visibility, not just document visibility.
- React Compiler / eslint `preserve-manual-memoization` can require destructuring values returned from hooks before referencing them inside `useCallback` dependency arrays. Keeping a whole returned object in the dependency list may trigger lint/compiler failures during refactors even when the code is otherwise type-safe.

## Integration Seams (CRITICAL)
- ~55 Convex HTTP route paths called by server, Python, and datauploader
- WebSocket message protocol (11 message types)
- Python __EVENT__ stdout protocol
- store.ts singleton state
- Express middleware registration order
