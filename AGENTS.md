# Agent Navigation Map

This file is intentionally short and map-first.

Rule of precedence:
- `docs/` is the system of record.
- If `AGENTS.md` conflicts with `docs/`, follow `docs/`.

## Canonical Documentation

- Docs index: [docs/README.md](docs/README.md)
- Knowledge model: [docs/overview/knowledge-model.md](docs/overview/knowledge-model.md)
- Repository map: [docs/overview/repository-map.md](docs/overview/repository-map.md)
- Developer workflow: [docs/overview/developer-workflow.md](docs/overview/developer-workflow.md)

Domain guides:
- Frontend: [docs/frontend/guide.md](docs/frontend/guide.md)
- Frontend component audit: [docs/frontend/component-audit.md](docs/frontend/component-audit.md)
- Server: [docs/server/guide.md](docs/server/guide.md)
- Python automation: [docs/python/automation.md](docs/python/automation.md)
- Python components: [docs/python/components.md](docs/python/components.md)
- Convex backend: [docs/convex/backend.md](docs/convex/backend.md)

Service guides:
- Data uploader: [docs/services/datauploader.md](docs/services/datauploader.md)
- Scraper: [docs/services/scraper.md](docs/services/scraper.md)

Operations:
- Environment and security: [docs/operations/environment-and-security.md](docs/operations/environment-and-security.md)
- Docker runtime: [docs/operations/docker-and-runtime.md](docs/operations/docker-and-runtime.md)
- Troubleshooting: [docs/operations/troubleshooting.md](docs/operations/troubleshooting.md)
- Content mapping: [docs/operations/content-parity.md](docs/operations/content-parity.md)
- Drift matrix: [docs/operations/drift-matrix.md](docs/operations/drift-matrix.md)
- Verification log: [docs/operations/verification-log.md](docs/operations/verification-log.md)

## Quick Repo Map

- `frontend/`: React Router app (`root.tsx`, `routes.ts`, route modules, feature-owned UI for `profiles`, `lists`, `scraping`, `workflows`, `accounts`, `logs`, `vnc`, `monitoring`).
- `server/`: Express API route files (`automation`, `profiles`, `lists`, `logs`, `scraping`, `workflows`, `monitoring`, `displays`) + WebSocket.
- `python/`: automation runtime entrypoints and internal systems.
- `convex/`: schema/modules/http/crons/migrations including `keywords`, `scrapingTasks`, `workflows`.
- `datauploader/`: CSV + scraping-task ingest service.
- `scraper/`: follower/following scraping service.
- `data/`: runtime logs/uploads.

## Quick Commands

- `npm run dev` (root)
- `npm run build` (root)
- `npm run test:convex`
- `npm --prefix frontend run dev`
- `npm --prefix frontend run build`
- `npm --prefix frontend run lint`
- `npm --prefix server run dev`
- `npm --prefix server run build`
- `python -m pytest python/tests -q`
- `docker compose up --build`

## Coding and Testing Rules

- TypeScript/TSX: 2-space indentation, single quotes, semicolon-light style.
- React components: `PascalCase` filenames.
- Hooks: `useX.ts` or `useX.tsx` naming.
- Python: PEP 8 and snake_case naming.
- For Convex changes, run `npm run test:convex` and add or update relevant tests in `convex/tests/`.
- For frontend/server changes without dedicated tests, run lint + build.
- Add/update tests when changing automation behavior, parsing, retries, or state handling.

## Security Notes

- Use `.env` and `.env.local`; never commit secrets.
- Validate auth/CORS/rate-limit behavior when editing `server/security/*`.
- Keep links repo-relative.
