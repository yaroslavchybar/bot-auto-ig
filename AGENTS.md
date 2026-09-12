# Agent Navigation Map

This file is intentionally short and map-first.

Rule of precedence:
- `docs/` is the system of record.
- If `AGENTS.md` conflicts with `docs/`, follow `docs/`.

## Canonical Documentation

- All guidance consolidated in [docs/README.md](docs/README.md) (system of record).

## Quick Repo Map

- `frontend/`: React Router app (`root.tsx`, `routes.ts`, route modules, feature-owned UI for `profiles`, `lists`, `workflows`, `accounts`, `logs`, `vnc`, `monitoring`).
- `server/`: Express API route files (`automation`, `profiles`, `lists`, `logs`, `workflows`, `monitoring`, `displays`) + WebSocket.
- `python/`: automation runtime — `runners/` (entry points), `actions/` (Instagram domain), `browser/` (lifecycle), `database/` (Convex clients), `core/` (infra).
- `convex/`: schema/modules/http/crons/migrations including `keywords`, `workflowArtifacts`, `workflows`.
- `datauploader/`: CSV + workflow-artifact ingest service.
- `data/`: runtime logs/uploads.

## Quick Commands

- `bun run dev` (root)
- `bun run build` (root)
- `bun run test:convex`
- `bun run --filter frontend dev`
- `bun run --filter frontend build`
- `bun run --filter frontend lint`
- `bun run --filter anti-server dev`
- `bun run --filter anti-server build`
- `python -m pytest python/tests -q`
- `docker compose up --build`

## Coding and Testing Rules

- TypeScript/TSX: 2-space indentation, single quotes, semicolon-light style.
- React components: `PascalCase` filenames.
- Hooks: `useX.ts` or `useX.tsx` naming.
- Python: PEP 8 and snake_case naming.
- For Convex changes, run `bun run test:convex` and add or update relevant tests in `convex/tests/`.
- For frontend/server changes without dedicated tests, run lint + build.
- Add/update tests when changing automation behavior, parsing, retries, or state handling.

## Security Notes

- Use `.env` and `.env.local`; never commit secrets.
- Validate auth/CORS/rate-limit behavior when editing `server/security/*`.
- Keep links repo-relative.
