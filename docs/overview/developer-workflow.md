# Developer Workflow

## Core Commands

From repository root:
- `npm run dev` (server dev mode)
- `npm run build` (server build via root script)
- `npm run start` (server start via root script)
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

## Coding Conventions

- TypeScript/TSX: 2-space indentation, single quotes, semicolon-light style.
- React components: `PascalCase` filenames.
- Hooks: `useX.ts`.
- Python: PEP 8, snake_case naming.

## Testing Expectations

- Python tests are `test_*.py` in `python/tests/` (unittest style, pytest-compatible execution).
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
- `python/tests/*`
- `AGENTS.md`
