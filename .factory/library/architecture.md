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

### Import Direction Rules
- Server: routes → services → data access (never reverse)
- Python: runners → actions → (core|browser), runners → database → core
- No circular imports allowed

## Integration Seams (CRITICAL)
- ~55 Convex HTTP route paths called by server, Python, and datauploader
- WebSocket message protocol (11 message types)
- Python __EVENT__ stdout protocol
- store.ts singleton state
- Express middleware registration order
