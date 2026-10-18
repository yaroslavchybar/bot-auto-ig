# Repository Documentation (System of Record)

Account onboarding, model content, and warmup: [ig-accounts.md](ig-accounts.md).

Profile unread chat counts come from Instagram’s browser badge at session close. Scraping and monitoring use saved browser cookies; account post discovery uses Apify.

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

Instagram automation platform: React frontend, Rust/Axum API,
Bun browser workers, CloakBrowser stealth Chromium automation, and Convex shared data layer. Package manager and browser-worker runtime: Bun
(`packageManager: bun@1.4.2`, workspaces `frontend` + `server`).

- `frontend/`: React + Vite+ app.
  Feature-owned UI under `src/features/` (`profiles`, `models`, `automations`,
  `vnc`, `auth`); shared
  `components/ui|layout|shared`, `hooks/`, `lib/`. Browser reads/writes Convex
  directly (no per-user identity); Axum handles the public API.
- `tools/runtime/`: Rust/Axum public REST (`/api/profiles|automations|displays|lead-lists|ig-accounts|health`), Telegram authentication, public WebSocket (`/ws`), VNC gateway, browser-cookie Instagram scraper HTTP/batching, Apify post discovery, and browser screening.
  `src/native/` owns model content and assignments,
  worker supervision, browser slots, display lifecycles, native X11/JPEG previews,
  routine scheduling, profile locks and folder maintenance, account services, login/model
  setup coordination, proxy probing, clipboard ownership and file-picker forwarding.
  All server-side Convex subscriptions use one shared connection.
  Requests are limited to 64 in flight. Normal authenticated requests use 100/min per IP;
  model images use 600/min, Telegram links 10/min, and login polling 120/min.
  `/api/automations` also accepts `INTERNAL_API_KEY`.
- `server/`: private named worker commands on loopback, authenticated with `INTERNAL_API_KEY`.
  Playwright browser actions, browser login, and browser posting remain TypeScript.
  Rust owns the surrounding validation, retries and durable model setup state.
  Browser workers receive subscription updates and resource leases
  over authenticated local Rust sockets; they do not open Convex subscription connections.
  React and Convex functions remain TypeScript.
- `server/browser/`: CloakBrowser sessions, profile persistence, and login/manual
  browser entrypoints.
- `server/automation/`: Bun workers and TypeScript Instagram actions
  (feed browsing, story watching). Automation workers
  emit `__EVENT__`-prefixed JSON for WebSocket propagation.
- `convex/`: schema, queries/mutations (`profiles`, `models`, `automations`,
  `leads`), HTTP actions. Generated code in
  `convex/_generated/*` — never edit; regenerate via `bunx convex dev`.
- `data/`: git-ignored runtime state (application logs are JSON on stdout).

## Database models

Models use `models`, `modelIds`, and `profileModelAssignments`; scraped lead
lists retain their separate `leadLists` and `listId` names. Model content uses
a stable `contentKey` to locate its images on disk.
Screening results use `screeningStatus`, `screenedAt`, and
`englishTextCheckPassed`. Daily outreach usage and allowance remain shared by
public DMs and private follow requests.

## Application logs

There are no log screens, log history endpoints, or log WebSocket topics.
The API, automation/manual workers, Convex HTTP bridge, and image-processing
service emit structured JSON completion events. Logs include request/operation
IDs, duration, outcome, business identifiers/counts, and environment metadata.
Only `info` and `error` levels are used. Expected rejection, cancellation,
and request-limit/rate-limit pauses use `info` with an explicit outcome.

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

Root (`bun run …`): `build:rust`, `dev`, `dev:server`, `build`, `start`, `test:convex`, `typecheck`,
`lint`, `format`, `format:check`.
Workspaces: `bun run --filter frontend dev|build|lint|preview|typecheck|format|format:check`,
`bun run --filter anti-server dev|build|start|typecheck|lint`.
React regression checks: `bun run --filter frontend test:ui` (Vitest + Happy DOM).
Server: `bun run --filter anti-server build`. Docker: `docker compose up --build`
(services below); Convex: `bunx convex dev|deploy`.

### TypeScript and Vite+

All builds and typechecks use the standard `typescript` package, pinned to
**7.0.2** in all three manifests. There are no TypeScript 6 or compiler aliases.
`bun run typecheck` checks the server, frontend, and Convex. Rust services use `cargo check --workspace`.
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

On shutdown, new browser logins are blocked and active inline logins are cancelled.
Rust waits for Bun to acknowledge browser cleanup before draining account jobs;
Bun also drains logins before its own exit. Rust then stops subscription coordination and asks browser workers to stop
over stdin. It waits up to 20 seconds before killing their process trees, then allows
up to 15 seconds for final cleanup. Windows Job Objects and Linux process groups
keep browser descendants under their worker's ownership. Ownership is released only
after final status/checkpoint writes. Displays end when their owner's lease closes.
The managed controller then signals the private Bun server and allows up to 60 seconds
for it to finish. These are maximum waits; clean shutdowns finish sooner.
Convex reads and idempotent worker status saves retry transient failures up to
three times. Action claims remain single attempts. Worker completion logs include
bounded, redacted stdout/stderr diagnostics; malformed control frames are diagnostics too.

`frontend` 5173, `server` 3001, Rust spoofer 3002, Rust VNC gateway 3003.
The server's Rust controller hosts the VNC gateway on port 3003 and the helper
on loopback port 3004. Bun worker commands use
loopback port 3005; only the Rust API on 3001 is public. Browser workers, TigerVNC, and Fluxbox stay in the server
container. Desktops are created only when needed; RFB ports 5901–5950 bind only
to loopback. The gateway maps `/vnc/6081/websockify`
through `/vnc/6130/websockify` to those ports with bounded, asynchronous writes.

Install Rust **1.98.1**, then run `cargo build --workspace` before local development
or server tests. `bun run build` also builds release Rust binaries. Outside Docker,
the Bun worker starts the Rust API, helper, and VNC gateway automatically. The local gateway
binds to loopback; in Docker nginx connects to `server:3003`.

Run only one local dev session at a time. Stop the previous session before running
`bun dev` again: Windows locks an executable while it runs. The local Rust helper
shuts down when its Bun owner's stdin pipe closes, including after an abrupt exit.
If one dev service fails, `bun dev` stops the others so a failed build does not
leave frontend and Convex watchers running.

Routine browser workers exit after draining their ready profiles. Rust watches
Convex readiness, calculates wakeup deadlines, and launches the next Bun worker.
Concurrency is capped by `AUTOMATION_MAX_CONCURRENCY` (default 3).
Account setup uses the active browser for username, full name, avatar, and posting.
There is no separate mobile client or mobile session storage. Scraping uses saved
browser cookies through the profile's Work proxy, without opening a browser window.
Images: `oven/bun:1.4.2-*` for the server; `node:24.21.0-bookworm-slim` with Bun
for the frontend build and `nginx:alpine` for its runtime. Production frontend builds require `VITE_API_URL`,
`VITE_CONVEX_URL` as build args.

CI checks and image builds run in parallel. Production Convex deployment waits
for both, then the VPS pulls immutable image tags for that commit. Push checks
build debug Rust for tests; release binaries are built once in the production
Bookworm builders. PR checks still validate release builds.

Images with unchanged build inputs are reused from GHCR and tagged for the new
commit. The cache key includes tracked source and build configuration, frontend
URLs, and current base-image digests. Registry misses or reuse failures fall
back to a normal build. When Rust source changes, `cargo-chef` 0.1.78 preserves
compiled dependencies in a separate cached layer. Runtime source changes no
longer invalidate the spoofer's final compile. The first build fills these caches;
later builds benefit from them.

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
The scraper always uses Apify to discover recent account posts.
`APIFY_API_KEY` is required for post discovery; browser cookies are not needed for this step.
The scraper calls Apify's HTTP endpoint directly with `reqwest`; it does not use
`apify-client-rust`.
The Sources tab attaches Instagram URLs or usernames to a lead list. Each list
sets a rolling "posts from the last X days" range (default 90 days). Sources
discover posts daily (default: latest 10 posts, maximum 5,000) and scrape each selected
post once. Every successfully scraped post can be monitored, regardless of its likes
or publication age. Checks run at randomized 1–3 hour intervals and stop 24 hours
after the first successful scrape. Sleep windows and request limits can delay checks,
but never extend the 24-hour cutoff. Rediscovery, pausing, and changing settings cannot
restart that clock. Expiration keeps collected leads. Sources can be paused, resumed, checked now, or removed;
removing a source keeps its collected leads.
The UI subscribes only to active tab data and the selected list. Post details use
explicitly opened, paginated queries. Lead searches wait 300 ms after typing and
pause obsolete page loads. Range and monitoring settings save explicitly.
Persisted due times drive Rust timers through a compact Convex subscription;
there is no periodic idle claim polling. Fenced leases recover interrupted work
and reject stale writes after settings changes, pauses, or deletion. A local
SQLite cache remembers acknowledged list memberships and skips repeated writes.
Leads are stored once by Instagram ID, with indexed rows linking them to lists.
Post likers and monitoring use each saved browser profile's sessionid cookie,
csrftoken, and Work proxy. This restores the cookie-based collection introduced
in commit `761af570`, using its Rust implementation from `53f9b3f7`.
Cookies refresh on browser open and close. Each HTTP dispatch verifies the source
lease, browser ownership, pause state, request capacity, and proxy-country sleep window.
A 429 cools down the profile; no other session can bypass it.
Liker collection always saves private accounts, including when older lists disabled them.
Scraped likers wait for browser screening during outreach. The worker opens the
lead profile, captures the viewport, and sends it to `openai/gpt-6-luna-decisions`.
Each automation selects its allowed categories: male, female, or business.
Personal gender labels require explicit public self-description, never appearance;
unclear decisions are saved and skipped. Screenshots stay in memory, not storage.
Liker collection requests up to 100 accounts per post, saves them in Convex
batches of 25, and waits 10–20 seconds between post checks. No mobile metadata request is needed.
There is no background enrichment or separate profile-picture description call.
Screening decisions must reach 80% confidence; errors retry after five minutes.
Only accepted categories receive a sender assignment and consume a follow slot.
Every browser profile shares a fixed rolling limit of 10 browser-cookie scraper
requests per hour across initial liker collection and monitoring. Failed dispatches
count; bridge retries do not double-charge. Apify discovery and Playwright browser
actions do not consume this quota. Saving leads consumes no request slots. Usage
survives runtime restarts. Each profile has a stable randomized local wake time
between 06:00 and 10:00, followed by 16 active hours. The saved proxy country selects
a representative IANA timezone; missing countries block requests until configured.
Requests happen only for real work, not to fill the budget. The Scrapers table shows
rolling-hour usage, sleep status, and local wake/sleep times.
The profile menu has Pause Profile / Resume Profile. Pausing excludes a profile
from automations, setup, login queues, scraping, and browser-cookie requests. It stops its
automated browser work and releases scraper leases while preserving credentials,
progress, and request usage. The Info button in Profiles Manager opens live profile details,
including pause/resume, errors, daily outreach, next session, setup progress, and pending-action review.
The Info icon is red for errors and yellow for pending review. Login status stays visible
as an icon in the table; its toggle is inside profile details.
The automation popup's Profiles tab lists profile names only. A real Instagram 429 cools down that account for at least 30 minutes, with
longer waits after repeated 429s or when Instagram sends `Retry-After`.
`OPENROUTER_API_KEY` powers screenshot decisions and topic search generation.
`BROWSER_MAX_CONCURRENCY` (default `1`, free Cloak tier allows one browser) caps active browser sessions across all
workers launched by one server, including manual/login sessions. Workers must be
launched through the server so they share its resource budget; waiting is cancellable.
`DISABLE_AUTH=true` bypasses auth in local dev only. High-risk edit
areas: `tools/runtime/src/api/`, `tools/runtime/src/scraper/`,
`tools/runtime/src/native/`, `server/worker/`, and `convex/http.ts`.

## Automation & Quality Gates

- Automation checkpoints are separate from UI events. Pending database snapshots
  coalesce in Rust. Event sockets have a 1 MiB message limit and five-second send
  timeouts; lagging clients disconnect when the bounded broadcast queue overflows.

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
