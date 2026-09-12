# Repository Documentation (System of Record)

Consolidated from the former per-area guides. `docs/` remains canonical;
`AGENTS.md` is the short navigation map; module READMEs are pointer stubs.
Conflict order: `docs/` → `AGENTS.md` → README stubs.

## What This Repo Is

Instagram automation platform: React frontend, Express orchestration
server, Camoufox JS browser automation, Convex shared data layer. Package manager and server runtime: Bun
(`packageManager: bun@1.4.2`, workspaces `frontend` + `server`).

- `frontend/`: React + Vite app.
  Feature-owned UI under `src/features/` (`profiles`, `lists`, `workflows`,
  `logs`, `vnc`, `scraped-data`, `auth`); shared
  `components/ui|layout|shared`, `hooks/`, `lib/`. Browser reads/writes Convex
  directly (no per-user identity); Express handles orchestration only.
- `server/`: Express REST (`/api/automation|profiles|lists|logs|workflows|displays|health`)
  + public `/api/auth/*` (Telegram login) + WebSocket (`/ws`) + Bun/Camoufox
  subprocess orchestration. Admin session middleware globally;
  `/api/workflows` also accepts `INTERNAL_API_KEY`. Rate limits:
  general 100/min, automation 10/min, writes 30/min. Resolves repo-root paths
- `server/browser/`: Camoufox JS sessions, profile persistence, and login/manual
  browser entrypoints.
- `server/automation/`: Bun workers and TypeScript Instagram actions. Workers
  emit `__EVENT__`-prefixed JSON for WebSocket propagation.
- `convex/`: schema, queries/mutations (`profiles`, `lists`, `workflows`,
  `workflowArtifacts`, `instagramAccounts`, `scrapingAccounts`,
  `messageTemplates`), HTTP actions, crons. Generated code in
  `convex/_generated/*` — never edit; regenerate via `bunx convex dev`.
- `data/`: runtime logs/uploads (git-ignored).

## Commands

Root (`bun run …`): `dev`, `build`, `start`, `test:convex`,
`dev:local*` (Windows launcher `dev-local.ps1` for server+frontend,
optional `-WithConvex`, `-UseTabs`).
Workspaces: `bun run --filter frontend dev|build|start|lint|preview|typecheck`,
`bun run --filter anti-server dev|build|start`.
Server: `bun run --filter anti-server build`. Docker: `docker compose up --build`
(services below); Convex: `bunx convex dev|deploy`.

## Local Ports & Docker

`frontend` 5173, `server` 3001, VNC 6080 + 6081–6130.
Images: `oven/bun:1.4.2-*` for server/frontend. Production frontend builds require `VITE_API_URL`,
`VITE_CONVEX_URL` as build args.

## Authentication

Telegram Login Widget via the shared igscrape bot (widget flow only — the
bot's webhook belongs to igscrape). Only `TELEGRAM_ADMIN_ID` can sign in;
sessions are HMAC-signed tokens (cookie + Bearer, 30 days). Endpoints:
`GET /api/auth/config|me`, `POST /api/auth/login|dev-login|logout`.
The widget only works on the BotFather-registered domain; localhost uses the
dev-login button (`POST /api/auth/dev-login`, non-production only) or
`DISABLE_AUTH=true`. Login page: `/login`.

## Environment & Security

Secrets live in `.env.local`, never committed. Key vars: `SERVER_PORT`,
`CONVEX_URL`, `TELEGRAM_BOT_TOKEN`/`TELEGRAM_BOT_USERNAME`/`TELEGRAM_ADMIN_ID`,
`INTERNAL_API_KEY` (server→Convex calls),
`CONVEX_URL_DEV/PROD`.
`DISABLE_AUTH=true` bypasses auth in local dev only. High-risk edit
areas: `server/auth/*`, `server/security/*`, `server/index.ts` (CORS/auth mounting),
`server/websocket.ts`, `convex/http.ts`.

## Workflow & Quality Gates

- Bun workspaces; `bun install --frozen-lockfile` must be clean.
- Convex changes: add/update `convex/tests/` + `bun run test:convex`.
- Frontend/server changes without dedicated tests: `lint` + `build`.
- Automation/parsing/retry/state changes: add/update tests.
- Conventions: TS/TSX 2-space (server files historically 4-space), single
  quotes, semicolon-light; components `PascalCase`; hooks `useX.*`; English-only
  strings.
- PRs: what/why, impacted modules, verification commands, UI screenshots.
- Troubleshooting first checks: Telegram env present, backend on :3001,
  `bun` on PATH, `wt.exe` for `-UseTabs`, Convex URLs consistent.
- Update this file in the same change as runtime behavior changes.
