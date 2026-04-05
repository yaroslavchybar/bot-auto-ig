# Developer Workflow

## Core Commands

From repository root:
- `npm run dev` (server dev mode)
- `npm run dev:local` (Windows PowerShell launcher for server + frontend in separate shells)
- `npm run dev:local:full` (same launcher plus `datauploader` and `npx convex dev`)
- `npm run dev:local:tabs` (same stack as `dev:local` but opened in Windows Terminal tabs)
- `npm run dev:local:full:tabs` (full local stack in Windows Terminal tabs)
- `npm run build` (server build via root script)
- `npm run start` (server start via root script)
- `npm run test:convex` (Convex self-test harness via Vitest + convex-test)
- `docker compose build server` (targeted server image rebuild)
- `docker compose build frontend` (targeted frontend image rebuild)
- `docker compose build datauploader` (targeted uploader image rebuild)
- `docker compose up --build` (full stack)

Module-level:
- `npm --prefix frontend run dev`
- `npm --prefix frontend run build`
- `npm --prefix frontend run lint`
- `npm --prefix frontend run preview`
- `npm --prefix server run dev`
- `npm --prefix server run build`
- `npm --prefix server run start`
- `python -m pytest python/tests -q`

## Windows Local Launcher

- `dev-local.ps1` is the shared Windows bootstrap used by the root `dev:local*` scripts.
- It starts from the repository root, opens `server` and `frontend` by default, and can optionally add `datauploader` plus `npx convex dev`.
- Default local ports remain `frontend` `5173`, `server` `3001`, and `datauploader` `3002` when enabled.
- Python resolution order is explicit: passed `-PythonPath`, then `.venv\Scripts\python.exe`, then `python`, then `py -3.11`.
- `-UseTabs` requires `wt.exe` on `PATH`; otherwise the launcher opens separate PowerShell windows.
- `-NoNewWindows` runs each target in background PowerShell jobs instead of opening new windows.

## Coding Conventions

- TypeScript/TSX: 2-space indentation, single quotes, semicolon-light style.
- React components: `PascalCase` filenames.
- Hooks: `useX.ts` or `useX.tsx`.
- Python: PEP 8, snake_case naming.

## Testing Expectations

- Python tests are `test_*.py` in `python/tests/` (unittest style, pytest-compatible execution).
- Convex tests live under `convex/tests/` and run with `npm run test:convex`.
- Any change touching `convex/` must add or update relevant Convex tests.
- For frontend/server changes without dedicated tests, run lint + build.
- Add/update tests when changing automation logic, parsing, retries, or state handling.

## PR Expectations

PR descriptions should include:
- what changed and why,
- impacted modules,
- verification commands run,
- screenshots/GIFs for UI changes.

## Security Basics

- Keep secrets in `.env`/`.env.local`.
- Re-check auth/CORS/rate-limit behavior when editing `server/security/*`.

## Verified Against

- `package.json`, `frontend/package.json`, `server/package.json`
- `dev-local.ps1`
- `docker-compose.yml`
- `python/tests/*`
- `AGENTS.md`
