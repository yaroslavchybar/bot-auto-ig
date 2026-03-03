# Repository Guidelines

## Project Structure & Module Organization
- `frontend/`: React + Vite + TypeScript UI (`src/tabs/*`, `src/components/*`, `src/lib/*`).
- `server/`: Express + TypeScript API, automation orchestration, and WebSocket (`api/`, `automation/`, `security/`, `logs/`).
- `python/`: browser automation and shared internals; tests live in `python/tests/`.
- `convex/`: Convex schema/functions. Treat `convex/_generated/*` as generated code.
- `datauploader/` and `scraper/`: standalone Python services used by Docker Compose.
- `data/`: runtime artifacts (logs, uploads), mounted by containers.

## Build, Test, and Development Commands
- `npm run dev` (repo root): starts server dev mode via root script.
- `npm --prefix frontend run dev`: runs frontend at `http://localhost:5173`.
- `npm --prefix server run dev`: runs backend with hot reload on `:3001`.
- `npm --prefix frontend run build`: TypeScript compile + production bundle.
- `npm --prefix server run build`: compile server TypeScript to `server/dist`.
- `npm --prefix frontend run lint`: run ESLint for TS/TSX.
- `python -m pytest python/tests -q`: run Python test suite.
- `docker compose up --build`: start full stack (frontend, server, scraper, datauploader).

## Coding Style & Naming Conventions
- TypeScript/TSX: 2-space indentation, single quotes, semicolon-light style matching existing files.
- React components: `PascalCase` filenames (`LogsViewer.tsx`); hooks: `useX.ts`.
- Keep UI primitives in `frontend/src/components/ui/`; feature logic under `src/tabs/<feature>/`.
- Python: PEP 8 (4-space indentation), `snake_case` module/function names.

## Testing Guidelines
- Python tests follow `test_*.py` naming in `python/tests/`, written in pytest style.
- For frontend/server changes without dedicated tests, run lint + build before PR.
- Add or update tests when changing automation logic, parsing, retries, or state handling.

## Commit & Pull Request Guidelines
- Recent history uses short subjects (`updates`, `fixes`, `Workflows`); prefer clearer imperative messages, e.g. `server: tighten auth rate limiter`.
- Keep commits scoped to one concern.
- PRs should include:
  - what changed and why,
  - impacted areas (`frontend`, `server`, `python`, etc.),
  - verification commands run,
  - screenshots/GIFs for UI changes.

## Security & Configuration Tips
- Use `.env`/`.env.local`; never commit secrets (Clerk keys, Convex URLs, API keys).
- Validate CORS/auth settings when editing `server/security/*`.
