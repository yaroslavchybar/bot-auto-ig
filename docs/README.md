# Repository Documentation (System of Record)

Consolidated from the former per-area guides. `docs/` remains canonical;
`AGENTS.md` is the short navigation map; module READMEs are pointer stubs.
Conflict order: `docs/` → `AGENTS.md` → README stubs.

## What This Repo Is

Instagram automation platform: React frontend, Express orchestration
server, CloakBrowser stealth Chromium automation, Convex shared data layer. Package manager and server runtime: Bun
(`packageManager: bun@1.4.2`, workspaces `frontend` + `server`).

- `frontend/`: React + Vite app.
  Feature-owned UI under `src/features/` (`profiles`, `lists`, `automations`,
  `logs`, `vnc`, `auth`); shared
  `components/ui|layout|shared`, `hooks/`, `lib/`. Browser reads/writes Convex
  directly (no per-user identity); Express handles orchestration only.
- `server/`: Express REST (`/api/automation|profiles|lists|logs|automations|displays|health`)
  + public `/api/auth/*` (Telegram login) + WebSocket (`/ws`) + Bun/CloakBrowser
  subprocess orchestration. Admin session middleware globally;
  `/api/automations` also accepts `INTERNAL_API_KEY`. Rate limits:
  general 100/min, automation 10/min, writes 30/min. Resolves repo-root paths
- `server/browser/`: CloakBrowser sessions, profile persistence, and login/manual
  browser entrypoints.
- `server/automation/`: Bun workers and TypeScript Instagram actions
  (feed browsing, story watching). Automation workers
  emit `__EVENT__`-prefixed JSON for WebSocket propagation.
- `convex/`: schema, queries/mutations (`profiles`, `lists`, `automations`,
  `messageTemplates`), HTTP actions. Generated code in
  `convex/_generated/*` — never edit; regenerate via `bunx convex dev`.
- `data/`: git-ignored runtime state (logs are in-memory only, never written to disk).

Browser profiles use a 128 MiB Chromium disk-cache budget (a hint, not a hard
quota for the whole profile). Before each launch, while holding the profile
lock, disposable HTTP, code, GPU, media, and shader caches are pruned. Cookies,
local storage, IndexedDB, service workers, preferences, and fingerprint seeds
are preserved. Existing profiles are cleaned when next opened; running browsers
are never pruned. Cleanup errors are logged and do not prevent launch.

Profile deletion first persists `status: deleting`, then stops manual browsers
and any automation using the profile (stopping its whole worker). Browser
folders are removed before the database row. Failures remain visible as
Deleting and retry at startup and every 30 seconds. Browser launches and folder
maintenance share process locks in `data/profile-locks/`; pending profiles cannot
launch or be edited. Names remain reserved until cleanup finishes.
Locks use Bun's built-in SQLite writer transactions, backed by OS file locks.
They release on normal close or process death without PID checks or stale-file
reclamation. Their `.sqlite` files stay in place, including during startup;
never remove them while workers may be running. Windows device names such as
`CON`, `NUL.txt`, and `COM1` are rejected on all platforms.

UI edits go through the backend. Renames persist `renameFrom` until the browser
folder has moved; partial moves resume through the same retry loop.
Both names stay reserved meanwhile. Existing orphan folders are not automatically
deleted: missing database rows alone are not treated as permission to wipe data.

## Commands

Root (`bun run …`): `dev`, `dev:server`, `build`, `start`, `test:convex`, `typecheck`, `lint`.
Workspaces: `bun run --filter frontend dev|build|start|lint|preview|typecheck`,
`bun run --filter anti-server dev|build|start|typecheck`.
Server: `bun run --filter anti-server build`. Docker: `docker compose up --build`
(services below); Convex: `bunx convex dev|deploy`.

### TypeScript and ESLint

All builds and typechecks use TypeScript **7.0.2**, pinned as
`@typescript/native` (an npm alias for `typescript`). `bun run typecheck`
checks the server, frontend, and Convex. Convex CLI also finds this compiler.

The `typescript` dependency aliases `@typescript/typescript6@6.0.2` because
ESLint needs its JavaScript compiler API. It supplies `tsc6`, so it does not
compete with TypeScript 7's `tsc`. Keep both aliases aligned in all three
package manifests. This follows [Microsoft's setup guide](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).

`bun run lint` runs the existing frontend ESLint rules; server and Convex
currently use typechecks only. Install the recommended VS Code extensions
when prompted. Workspace settings select TypeScript 7 and the frontend
ESLint working directory. See the [TypeScript extension setup](https://marketplace.visualstudio.com/items?itemName=TypeScriptTeam.native-preview).

## Local Ports & Docker

`frontend` 5173, `server` 3001, VNC 6080 + 6081–6130.
Images: `oven/bun:1.4.2-*` for server/frontend. Production frontend builds require `VITE_API_URL`,
`VITE_CONVEX_URL` as build args.

## Authentication

Telegram deep-link login via the ig-bot bot (same flow as igscrape): the
login button jumps straight into the Telegram app via `tg://resolve`
(no browser tab), the user taps START in the bot, and the frontend polls
until the `tg-webhook` confirms the single-use token (10 min TTL).
Only `TELEGRAM_ADMIN_ID` can sign in;
sessions are HMAC-signed tokens (cookie + Bearer, 30 days). Endpoints:
`GET /api/auth/config|me|tg-poll`, `POST /api/auth/login|tg-link|tg-webhook|dev-login|logout`.
The server registers its webhook from `PUBLIC_BASE_URL` (falls back to
`APP_PUBLIC_URL`, then first `ALLOWED_ORIGINS`) on boot; without a public
URL (localhost) `tg-link` returns 503 and dev uses the
dev-login button (`POST /api/auth/dev-login`, non-production only) or
`DISABLE_AUTH=true`. Login page: `/login`.

## Environment & Security

Secrets live in `.env.local`, never committed. Key vars: `VITE_CONVEX_URL`
(convex dev manages it; server also accepts `CONVEX_URL`), `TELEGRAM_BOT_TOKEN`/`TELEGRAM_BOT_USERNAME`/`TELEGRAM_ADMIN_ID`,
`INTERNAL_API_KEY` (server→Convex calls).
`BROWSER_MAX_CONCURRENCY` (default `1`, free Cloak tier allows one browser) caps active browser sessions across all
workers launched by one server, including manual/login sessions. Workers must be
launched through the server so they share its resource budget; waiting is cancellable.
`DISABLE_AUTH=true` bypasses auth in local dev only. High-risk edit
areas: `server/auth/*`, `server/security/*`, `server/index.ts` (CORS/auth mounting),
`server/websocket.ts`, `convex/http.ts`.

## Automation & Quality Gates

- Automation checkpoints are separate from UI events. Pending database snapshots
  coalesce, and slow WebSocket clients are disconnected at a 1 MiB outbound buffer.

- Live VNC streams disconnect while the tab or viewer is hidden/off-screen and
  reconnect when visible. Failed connections back off to a 30-second retry delay.
- Display-session watchers pause background polling and do not retain log feeds.

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

Remote website file inputs open a local chooser in the viewer. Files travel as
in-memory buffers to Playwright (less than 50 MiB total, up to 20 files); the app creates
no upload files or temporary files. Nginx request buffering is disabled for this
route. If browser permissions prevent opening the local picker automatically,
the viewer shows a Choose files from this PC button.
