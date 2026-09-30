# Repository Documentation (System of Record)

Account onboarding, model content, and warmup: [ig-accounts.md](ig-accounts.md).

Chat storage, device sharing, polling, and retirement cleanup: [chat-caching.md](chat-caching.md).

Browser caching, memory changes, and measurements: [frontend-performance.md](frontend-performance.md).
Profiles, proxies, and account lists use 50-row pages with server-side search.
Search scans stop after five batches and return a continuation cursor. Unused
credential counts are exact through 100, then display 100+ for larger totals.
Production shell assets use hashed filenames and one-year browser caching;
HTML revalidates. Model previews use disk-cached thumbnails and release image
blobs off screen. Protected UI database connections close on logout.

Consolidated from the former per-area guides. `docs/` remains canonical;
`AGENTS.md` is the short navigation map; module READMEs are pointer stubs.
Conflict order: `docs/` → `AGENTS.md` → README stubs.

## What This Repo Is

Instagram automation platform: React frontend, Express orchestration
server, CloakBrowser stealth Chromium automation, Convex shared data layer. Package manager and server runtime: Bun
(`packageManager: bun@1.4.2`, workspaces `frontend` + `server`).

- `frontend/`: React + Vite+ app.
  Feature-owned UI under `src/features/` (`profiles`, `lists`, `automations`,
  `vnc`, `auth`); shared
  `components/ui|layout|shared`, `hooks/`, `lib/`. Browser reads/writes Convex
  directly (no per-user identity); Express handles orchestration only.
- `server/`: Express REST (`/api/profiles|automations|displays|lead-lists|chat|ig-accounts|health`)
  - public `/api/auth/*` (Telegram login) + WebSocket (`/ws`) + Bun/CloakBrowser
    subprocess orchestration. Admin session middleware globally;
    `/api/automations` also accepts `INTERNAL_API_KEY`. Rate limits:
    general 100/min, automation 10/min, writes 30/min. Authenticated model images
    use a separate 600/min limit and a one-hour private browser cache.
- `server/browser/`: CloakBrowser sessions, profile persistence, and login/manual
  browser entrypoints.
- `server/automation/`: Bun workers and TypeScript Instagram actions
  (feed browsing, story watching). Automation workers
  emit `__EVENT__`-prefixed JSON for WebSocket propagation.
- `convex/`: schema, queries/mutations (`profiles`, `lists`, `automations`,
  `messageTemplates`), HTTP actions. Generated code in
  `convex/_generated/*` — never edit; regenerate via `bunx convex dev`.
- `data/`: git-ignored runtime state (application logs are JSON on stdout).

## Application logs

There are no log screens, log history endpoints, or log WebSocket topics.
The API, automation/manual workers, Convex HTTP bridge, and image-processing
service emit structured JSON completion events. Logs include request/operation
IDs, duration, outcome, business identifiers/counts, and environment metadata.
Only `info` and `error` levels are used. Expected rejection, cancellation,
and daily-limit/rate-limit pauses use `info` with an explicit outcome.

`X-Request-Id` links API requests, Convex HTTP calls, worker processes, and
image-processing requests. Worker `__EVENT__` messages remain a separate control
protocol for automation checkpoints and live displays; they are not logs.

The API logger collects bounded step details and counts into each completion
event. Add business fields with `addLogContext`, and wrap background work with
`logOperation` from `server/shared/logger.ts`. Do not log payloads, cookies,
credentials, attachments, or DM text. The logger redacts sensitive fields,
known environment secrets, proxy credentials, and safe error representations.
Account login also registers account credentials for redaction in library errors.
Library console output is captured at API/worker startup and joins the current
completion event; informational browser banners stay at the info level.
Browser errors continue through the existing Sentry integration.

Deployment fields use `COMMIT_SHA` (or `GIT_COMMIT` in the API), `SERVICE_VERSION`,
`REGION`, and `INSTANCE_ID`; unset deployment values are marked `unknown` or use
local defaults. Production stdout logs are collected by Vector and sent to
the `ig-bot-prod` Axiom dataset. See [logging.md](logging.md) for the pipeline,
deployment, validation, and queries.

## Browser profile data

Browser profiles use a 128 MiB Chromium disk-cache budget (a hint, not a hard
quota for the whole profile). Before each launch, while holding the profile
lock, disposable HTTP, code, GPU, media, and shader caches are pruned. Cookies,
local storage, IndexedDB, service workers, preferences, and fingerprint seeds
are preserved.

Each manually opened browser also writes `data/profiles/<name>/dom-inspector.json` with a
temporary DOM inspection port. The read-only server binds to `127.0.0.1` inside
the server container and is removed when the browser closes. From the VPS,
read the port file with `docker exec ig-bot-server cat
/app/data/profiles/<name>/dom-inspector.json`, then query `/pages` for tab
indexes, `/aria?index=0` for accessible controls, or `/dom?index=0` for the
raw HTML on that port. The DOM can contain private account data; keep captures
out of logs and source control.

For full browser DevTools access, the manual session also starts Chromium's CDP
server on a random `127.0.0.1` port inside the container. While the profile is
open, the first line of `data/profiles/<name>/DevToolsActivePort` is its port;
`http://127.0.0.1:<port>/json/list` lists inspectable tabs. This exposes the
console, network, storage, and JavaScript debugging as well as the DOM. The
port is not published outside the container. In the VNC browser window, F12
opens the graphical DevTools. CDP has full control of the logged-in browser, so
keep it on loopback and remove access when the session closes.
Automation and account-login sessions do not start either inspection port.

Convex stores each profile's cookies and fingerprint seed. On open, a seed in
Convex wins; otherwise the app uses a matching local `cloak-seed.json` seed, or
creates one if neither exists. It saves the chosen seed to both places. On each
open, the app replaces disk cookies with the Convex copy and saves refreshed
cookies on open and close. The disk cookie jar is not a fallback when Convex is
unavailable. Cloak Chromium 151+ writes these cookies in a portable format
because `--fingerprint-portable-cookies` is enabled.

`server/browser/seedBackfill.ts` handles profiles created before seeds were
stored in Convex. At startup it copies seeds from local files even if those
profiles are never opened. Failed writes are retried; if they still fail, the
server does not start. New profiles save their seeds when first opened.

On a future VPS using the same Convex deployment, cookies and seeds can be
restored. Keep the same proxy and Cloak binary version where possible: a changed
IP can trigger an Instagram login challenge, and a newer Cloak binary may
produce a different fingerprint from the same seed. Close browser sessions
cleanly before a move so their latest cookies reach Convex.

A paid Pro plan can pin the old binary on the new VPS with
`CLOAKBROWSER_VERSION`. Changing a profile's fingerprint OS clears its saved seed.
At startup, complete older Cloak Pro binaries are pruned only after Cloak has
recorded a usable version in its cache marker. The newest usable binary, marked
versions, and configured or pinned binaries are retained. Existing profiles are
cleaned when next opened; running browsers are never pruned. Cleanup errors are
logged and do not prevent launch.

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

Root (`bun run …`): `dev`, `dev:server`, `build`, `start`, `test:convex`, `typecheck`,
`lint`, `format`, `format:check`.
Workspaces: `bun run --filter frontend dev|build|lint|preview|typecheck|format|format:check`,
`bun run --filter anti-server dev|build|start|typecheck|lint`.
React regression checks: `bun run --filter frontend test:ui` (Vitest + Happy DOM).
Server: `bun run --filter anti-server build`. Docker: `docker compose up --build`
(services below); Convex: `bunx convex dev|deploy`.

### TypeScript and Vite+

All builds and typechecks use the standard `typescript` package, pinned to
**7.0.2** in all three manifests. There are no TypeScript 6 or compiler aliases.
`bun run typecheck` checks the server, frontend, Convex, and spoofer scripts.
Convex CLI also finds this compiler. Workspace settings point the TypeScript
extension at `node_modules/typescript`.

Use Node **24.21.0** from `.node-version` for the tooling; Bun **1.4.2** remains
the package manager and server runtime. Run `bun install --frozen-lockfile`.
The frontend uses Vite+ **1.0.0**, including Vite, Rolldown, and Oxc. Its bundled
Vitest **5.0.1** runs `bun run test:convex`; server and frontend utility tests
still run with `bun test server` and `bun test frontend`.
UI regression tests live in `tests/ui/`, separately from the Bun utility
tests so the two runners never execute each other's suites.

`bun run lint` runs Oxlint across the app, tests, and tooling, excluding generated
Convex files and build outputs. Root `vite.config.ts` holds shared lint, format,
and Convex test settings; `frontend/vite.config.ts` holds application build settings.
Frontend checks retain error-level core and TypeScript rules plus rules-of-hooks.
React compiler diagnostics remain errors; effect-driven resets, render-time
clock reads, and component identity issues found during migration are fixed.
Oxlint does not implement the old React compiler `config`
and `gating` rules; this app does not configure React Compiler or its gating.

`bun run format` and `bun run format:check` use Oxfmt, preserving single quotes,
no semicolons, and Tailwind class sorting against `frontend/src/index.css`.
Formatting the whole repository is opt-in; this migration does not reformat
existing application code. Install the recommended TypeScript and Oxc VS Code
extensions. ESLint and Prettier are no longer direct development dependencies;
Convex still brings its own internal Prettier dependency.

Tool versions are pinned as a compatible Vite+ bundle, not independently
overridden. See the [Vite+ migration rules](https://viteplus.dev/guide/migrate-rules).

## Local Ports & Docker

On container shutdown, Supervisor sends SIGTERM directly to the server and
allows 60 seconds for in-flight operations and worker cleanup. The server asks
workers to close browsers, waits up to 10 seconds, then force-stops stragglers
(with up to 5 more seconds for SIGTERM on Linux). Display services stop after
the server. Both Compose configurations allow 90 seconds before Docker forces
the container to exit. These are maximum waits; clean shutdowns finish sooner.

`frontend` 5173, `server` 3001, VNC 6080 + 6081–6130.
Images: `oven/bun:1.4.2-*` for the server; `node:24.21.0-bookworm-slim` with Bun
for the frontend build and `nginx:alpine` for its runtime. Production frontend builds require `VITE_API_URL`,
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
The scraper uses an existing Instagram Chat mobile session to get recent posts.
`APIFY_API_KEY` enables fallback when mobile post discovery is unavailable.
The UI accepts a number of days and a maximum post count per profile; each source
job stores the post limit and fixes the date cutoff when queued.
Active jobs use an indexed key to prevent duplicate queued work. Leads are stored
once by Instagram ID, with indexed rows linking them to target lists.
Saved Instagram sessions collect post likers. Private accounts are discarded
before saving. AI classifies public likers from username, full name, and
profile picture description; bio is not collected.
Liker collection makes one request for up to 100 accounts per post, saves them
in Convex batches of 25, and waits 10–20 seconds between posts.
Profile pictures are described through regular OpenRouter GPT-6 Luna calls
with reasoning disabled. Descriptions are saved before TypeSafe Jev classifies leads,
so a classification retry does not repeat the picture call. Clearing a profile's
daily limit removes its cap. Saved likers and completed mobile-discovered posts
share that quota; repeated post checkpoints do not add usage. The quota is
separate from Instagram's
request limits. A 429 cools down that account for at least 30 minutes, with
longer waits after repeated 429s or when Instagram sends `Retry-After`.
`OPENROUTER_API_KEY` powers both AI steps.
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
