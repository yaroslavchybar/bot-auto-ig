# Repository Documentation (System of Record)

This `docs/` directory is the canonical source for architecture, runtime behavior, API surfaces, environment policy, and troubleshooting.

Documentation contract:
- `docs/` is canonical.
- `AGENTS.md` is a short navigation map for agent context.
- Module `README.md` files are pointer stubs to canonical docs.

Conflict resolution order:
1. `docs/` pages
2. `AGENTS.md`
3. Module `README.md` stubs

## Docs Index

### Overview
- [Knowledge Model](./overview/knowledge-model.md)
- [Repository Map](./overview/repository-map.md)
- [Developer Workflow](./overview/developer-workflow.md)

### Core Subsystems
- [Frontend Guide](./frontend/guide.md)
- [Server Guide](./server/guide.md)
- [Python Automation Guide](./python/automation.md)
- [Python Components Reference](./python/components.md)
- [Convex Backend Guide](./convex/backend.md)

### Services
- [Data Uploader Service](./services/datauploader.md)
- [Scraper Service](./services/scraper.md)

### Operations
- [Environment and Security](./operations/environment-and-security.md)
- [Docker and Runtime Operations](./operations/docker-and-runtime.md)
- [Troubleshooting](./operations/troubleshooting.md)
- [README-to-Docs Content Mapping](./operations/content-parity.md)
- [Docs Drift Matrix](./operations/drift-matrix.md)
- [Verification Log](./operations/verification-log.md)

## Maintenance Rules

- Keep deep technical content in `docs/`, not in `AGENTS.md`.
- Keep README stubs link-first and concise.
- Use repo-relative links only (no machine-local absolute URIs).
- Update docs in the same change as runtime behavior changes.
- Keep root proof commands discoverable; Convex local verification runs through `npm run test:convex`.
- Keep drift matrix current when stale docs are discovered.
