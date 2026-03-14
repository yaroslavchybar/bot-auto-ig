# Foundation Milestone — Validation Assertions

---

## A. Sentry SDK Integration — Frontend

### VAL-FOUND-001: Sentry client-side initialization exists
`@sentry/react-router` is imported and `Sentry.init()` is called in `frontend/src/entry.client.tsx` before `hydrateRoot`. The DSN is read from an environment variable (never hardcoded).
**Evidence:** Read `frontend/src/entry.client.tsx`; confirm `Sentry.init({dsn: …})` precedes the `hydrateRoot` call. Verify no literal DSN string in source.

### VAL-FOUND-002: Sentry server-side initialization exists for React Router SSR
An instrumentation file (e.g. `frontend/instrument.server.mjs` or equivalent) calls `Sentry.init()` for the server render path.
**Evidence:** File exists and is referenced in `frontend/package.json` scripts via `NODE_OPTIONS='--import ./instrument.server.mjs'` or equivalent cross-platform mechanism.

### VAL-FOUND-003: Sentry React Router tracing integration is configured
`Sentry.reactRouterTracingIntegration()` is included in the `integrations` array of the client-side `Sentry.init()`.
**Evidence:** Grep `frontend/src/entry.client.tsx` for `reactRouterTracingIntegration`.

### VAL-FOUND-004: ErrorBoundary reports to Sentry
`frontend/src/components/shared/ErrorBoundary.tsx` calls `Sentry.captureException(error)` inside `componentDidCatch` (or equivalent). The root `ErrorBoundary` in `root.tsx` also captures to Sentry.
**Evidence:** Grep `ErrorBoundary.tsx` and `root.tsx` for `Sentry.captureException`.

### VAL-FOUND-005: @sentry/react-router package is in frontend dependencies
`frontend/package.json` lists `@sentry/react-router` in `dependencies`.
**Evidence:** Read `frontend/package.json`, confirm the package and a version constraint exist.

### VAL-FOUND-006: Sentry source map plugin configured in Vite
`frontend/vite.config.ts` includes `sentryReactRouter` (or `@sentry/vite-plugin`) in the plugins array, reading auth token from environment.
**Evidence:** Read `frontend/vite.config.ts`, confirm Sentry plugin presence. Verify auth token is not hardcoded.

### VAL-FOUND-007: SENTRY_DSN is documented in environment variable reference
`SENTRY_DSN` (and optionally `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_AUTH_TOKEN`) are listed in `docs/operations/environment-and-security.md` or `.env.example`.
**Evidence:** Grep docs and `.env.example` for `SENTRY_DSN`.

---

## B. Sentry SDK Integration — Server (Express)

### VAL-FOUND-008: Sentry Node SDK initialization file exists
A file such as `server/instrument.ts` (or top-of-`index.ts` import) calls `Sentry.init()` with DSN from environment. It must be the first meaningful import.
**Evidence:** Verify `@sentry/node` `Sentry.init()` runs before Express app creation in `server/index.ts` (or via a pre-imported instrument file).

### VAL-FOUND-009: Sentry Express error handler is registered
`Sentry.setupExpressErrorHandler(app)` is called after all route registrations but before any custom error-handling middleware in `server/index.ts`.
**Evidence:** Read `server/index.ts`, confirm `setupExpressErrorHandler` placement relative to route `app.use(…)` calls.

### VAL-FOUND-010: @sentry/node package is in server dependencies
`server/package.json` lists `@sentry/node` in `dependencies`.
**Evidence:** Read `server/package.json`.

### VAL-FOUND-011: Server startup loads Sentry before all other code
The `server/package.json` `dev` and `start` scripts use `--import ./instrument.ts` (or `--require`) or the instrument file is the first import in `index.ts`.
**Evidence:** Read `server/package.json` scripts, confirm instrumentation ordering.

---

## C. Sentry SDK Integration — Python

### VAL-FOUND-012: sentry-sdk is in Python requirements
`python/requirements.txt` includes `sentry-sdk`.
**Evidence:** Read `python/requirements.txt`.

### VAL-FOUND-013: Sentry is initialized in Python runner entry points
All runner entry points (`python/runners/workflow/entrypoint.py`, `python/runners/multi_account/entrypoint.py`, `python/runners/run_multiple_accounts.py`) call `sentry_sdk.init()` early in their execution.
**Evidence:** Grep each entry point for `sentry_sdk.init`.

### VAL-FOUND-014: Python Sentry flushes before process exit
Each runner entry point calls `sentry_sdk.flush()` in a `finally` block or via `atexit` to ensure events are sent before the short-lived process terminates.
**Evidence:** Grep entry points for `sentry_sdk.flush` or `atexit.register`.

### VAL-FOUND-015: Python Sentry DSN read from environment
`sentry_sdk.init(dsn=os.environ.get("SENTRY_DSN"))` — DSN is never hardcoded.
**Evidence:** Grep all Python files for `sentry_sdk.init`; confirm DSN source is env var.

### VAL-FOUND-016: Python error handler enriches Sentry context
`python/core/errors/handler.py` or surrounding code calls `sentry_sdk.set_context()`, `sentry_sdk.set_tag()`, or `sentry_sdk.set_user()` to attach account/workflow metadata to captured exceptions.
**Evidence:** Grep `python/core/errors/` for `sentry_sdk.set_context`, `set_tag`, or `set_user`.

---

## D. Structured Logging — Server (pino)

### VAL-FOUND-017: pino is in server dependencies
`server/package.json` lists `pino` (and optionally `pino-pretty` as devDependency) in dependencies.
**Evidence:** Read `server/package.json`.

### VAL-FOUND-018: A shared logger instance is exported
A file such as `server/logger.ts` (or `server/lib/logger.ts`) creates and exports a pino logger instance.
**Evidence:** Glob for `server/**/logger.ts`; read the file; confirm `pino(…)` call.

### VAL-FOUND-019: No console.log in server source (non-test files)
Zero occurrences of `console.log`, `console.error`, `console.warn`, or `console.info` in `server/` TypeScript files (excluding test files `*.test.ts`).
**Evidence:** `rg 'console\.(log|error|warn|info)' server/ --glob '!*.test.ts'` returns zero matches.

### VAL-FOUND-020: Server index.ts uses structured logger
The startup messages in `server/index.ts` (port announcement, stale status clearing) use the pino logger, not `console.log`.
**Evidence:** Read `server/index.ts`; confirm `logger.info(…)` instead of `console.log(…)`.

### VAL-FOUND-021: Server API routes use structured logger
Files `server/api/automation.ts`, `server/api/profiles.ts`, `server/api/monitoring.ts`, `server/data/profiles.ts` use the shared pino logger.
**Evidence:** Grep `server/api/` and `server/data/` for `import.*logger` and absence of `console.log`.

### VAL-FOUND-022: Server WebSocket module uses structured logger
`server/websocket.ts` uses pino logger instead of `console.log`.
**Evidence:** Read `server/websocket.ts`; confirm no `console.log`.

### VAL-FOUND-023: Server automation modules use structured logger
`server/automation/state.ts`, `server/automation/process-manager.ts`, `server/automation/shutdown.ts` all use the pino logger.
**Evidence:** Grep each file for `console.` (should be zero) and `logger.` (should be present).

### VAL-FOUND-024: Server auth module uses structured logger
`server/security/auth.ts` uses pino logger, not `console.log`, for the API key status message.
**Evidence:** Read `server/security/auth.ts`; confirm no `console.log`.

### VAL-FOUND-025: Pino output is JSON in production
The pino configuration uses JSON transport by default (pino's default) without `pino-pretty` in production. `pino-pretty` may be used only when `NODE_ENV !== 'production'`.
**Evidence:** Read logger configuration; confirm no unconditional `pino-pretty` transport.

---

## E. Structured Logging — Python

### VAL-FOUND-026: python/core/logging.py setup_logging is called in all entry points
Every Python runner entry point calls `setup_logging()` from `python/core/logging.py` at startup.
**Evidence:** Grep entry points for `setup_logging` or `from python.core.logging import`.

### VAL-FOUND-027: No print() calls in Python source (excluding Dockerfile)
Zero occurrences of bare `print(` in `python/` `.py` files. All output goes through the `logging` module or the `compat.log` / `log` callback pattern.
**Evidence:** `rg 'print\(' python/ --glob '*.py'` returns zero matches (or only comments/docstrings).

### VAL-FOUND-028: Python JsonFormatter produces valid JSON
`python/core/logging.py` `JsonFormatter.format()` returns a JSON string parseable by `json.loads()` that includes at minimum: `timestamp`, `level`, `logger`, `message`.
**Evidence:** Unit test or manual inspection of `JsonFormatter.format()` output.

### VAL-FOUND-029: Python log files use RotatingFileHandler
`setup_logging()` configures `RotatingFileHandler` with a size limit (currently 10MB) and backup count.
**Evidence:** Read `python/core/logging.py`; confirm `RotatingFileHandler` params.

---

## F. Russian Text Elimination

### VAL-FOUND-030: No Cyrillic characters in Python log message strings
Zero Cyrillic characters (Unicode range `\u0400-\u04FF`) appear in string literals passed to `log()`, `compat.log()`, `logger.*()`, or `print()` calls across all `python/**/*.py` files.
**Evidence:** `rg '[\u0400-\u04FF]' python/ --glob '*.py'` returns zero matches outside of: (a) Playwright CSS selectors that match Instagram's Russian UI text (e.g., `публикац`, `подписки` in `filter.py` and `interactions.py`), and (b) inline comments if any.

### VAL-FOUND-031: runners/workflow/ files have no Russian log strings
All Russian strings in these files are translated to English:
- `runners/workflow/scrape_relationships.py` (lines 380, 856)
- `runners/workflow/runtime.py` (lines 186, 230, 268)
- `runners/workflow/io.py` (lines 43, 45 — Russian string prefixes in error classification)
- `runners/workflow/entrypoint.py` (lines 59, 64, 67, 76, 114, 126, 155)
- `runners/workflow/activity_dispatch.py` (lines 46, 389)
- `runners/workflow/account_session.py` (lines 101, 113, 222, 225)

**Evidence:** Read each file; confirm all log/error strings are in English.

### VAL-FOUND-032: runners/multi_account/ files have no Russian log strings
All Russian strings in these files are translated to English:
- `runners/multi_account/runtime.py` (lines 48, 92, 99, 112, 131)
- `runners/multi_account/entrypoint.py` (lines 19, 28, 37, 42, 46, 54, 86, 92, 105)
- `runners/multi_account/activity_dispatch.py` (lines 16, 19, 22, 66, 75, 80, 95, 112, 123, 133, 138, 157, 172, 187, 191, 203, 232)
- `runners/multi_account/account_session.py` (lines 17, 48, 52, 59, 102, 106, 148, 196, 200)

**Evidence:** Read each file; confirm English-only log strings.

### VAL-FOUND-033: actions/messaging/ files have no Russian log strings
All Russian strings translated in:
- `actions/messaging/ui.py` (lines 23, 26, 47, 68, 89, 110, 134, 144)
- `actions/messaging/session.py` (lines 30, 46, 50)
- `actions/messaging/runtime.py` (lines 83, 93, 95, 130, 136, 143, 153, 168, 170, 178, 183, 186, 190, 194, 206)
- `actions/messaging/db.py` (lines 10, 12)

**Evidence:** Read each file; confirm English-only log strings.

### VAL-FOUND-034: actions/engagement/ files have no Russian log strings
All Russian strings translated in:
- `actions/engagement/unfollow/runtime.py` (~30 Russian strings)
- `actions/engagement/follow/runtime.py` (~15 Russian strings)
- `actions/engagement/follow/posts_runtime.py` (~20 Russian strings)
- `actions/engagement/follow/highlights_runtime.py` (~25 Russian strings)
- `actions/engagement/follow/interactions.py` (~10 Russian strings)
- `actions/engagement/follow/search.py` (~15 Russian strings)
- `actions/engagement/follow/filter.py` (log messages only; CSS selectors for Instagram UI may retain Russian keywords)
- `actions/engagement/follow/common.py` (line 9)
- `actions/engagement/approve/ui.py` (~8 Russian strings)
- `actions/engagement/approve/session.py` (lines 37, 41)
- `actions/engagement/approve/flow.py` (~8 Russian strings)

**Evidence:** Read each file; confirm log/error strings are English. CSS selectors like `публикац` and `подписки` in `filter.py` and `interactions.py` are acceptable if they match Instagram's Russian locale UI — document this exception.

### VAL-FOUND-035: database/ and core/ files have no Russian log strings
All Russian strings translated in:
- `database/accounts.py` (lines 208, 211)
- `core/totp.py` (lines 16, 20, 26 — ValueError messages)
- `core/storage/profile_manager.py` (line 152 — default type string)

**Evidence:** Read each file; confirm English-only strings.

### VAL-FOUND-036: runners/run_multiple_accounts.py has no Russian strings
The error classification prefixes `ошибка` and `внимание` in `runners/run_multiple_accounts.py` (line 76) are translated or removed.
**Evidence:** Read the file; confirm no Cyrillic in string literals.

### VAL-FOUND-037: runners/workflow/io.py error classification uses English only
The `ошибка` and `внимание` prefixes in the error/warning classification logic (lines 43, 45) are replaced with English equivalents (or augmented while keeping backward compat).
**Evidence:** Read `runners/workflow/io.py`; confirm no Cyrillic in classification strings.

### VAL-FOUND-038: Instagram UI CSS selectors with Russian are documented as exceptions
Any remaining Cyrillic in Playwright CSS selectors (e.g., `публикац`, `подписки`, `подписок` in `filter.py` line 65/105/119/134 and `interactions.py` line 58) is documented as intentional — these match Instagram's Russian-language UI and must be preserved for Russian-locale accounts.
**Evidence:** A comment or doc entry explains these exceptions. Grep confirms only these selector strings remain.

---

## G. Dead Code Removal

### VAL-FOUND-039: No unreferenced Python files remain
Every `.py` file under `python/` is either (a) imported by at least one other module, (b) an entry point referenced from `server/api/automation.ts` spawn calls, or (c) a test file. No orphan modules exist.
**Evidence:** For each `.py` file, grep its module name across the codebase. Entry points are verified against `server/api/automation.ts` spawn args.

### VAL-FOUND-040: No unused imports in Python files
`python/` files have no unused `import` statements.
**Evidence:** Run `ruff check python/ --select F401` (or equivalent linter) — zero violations.

### VAL-FOUND-041: No unused imports in server TypeScript files
`server/` files have no unused imports.
**Evidence:** Run `npx tsc --noEmit` in `server/` — zero "declared but never read" errors.

### VAL-FOUND-042: No unused imports in frontend TypeScript files
`frontend/` files have no unused imports.
**Evidence:** Run `npm --prefix frontend run typecheck` — zero "declared but never read" errors.

### VAL-FOUND-043: No commented-out code blocks remain
No large blocks (≥3 consecutive lines) of commented-out code exist in `python/`, `server/`, or `frontend/src/`. Explanatory comments are fine; dead code behind `#` or `//` is not.
**Evidence:** Manual review or grep for patterns like consecutive `# ` lines containing code syntax.

### VAL-FOUND-044: Redundant legacy scripts are removed
If `python/runners/run_multiple_accounts.py` is superseded by `python/runners/multi_account/entrypoint.py`, the legacy file is either removed or clearly marked as deprecated with a redirect.
**Evidence:** Check if `run_multiple_accounts.py` is still referenced from `server/api/automation.ts`. If not referenced, it should not exist.

---

## H. Shared Error Handling Utilities — Server

### VAL-FOUND-045: Server has a shared error handling module
A file such as `server/lib/errors.ts` (or `server/errors/`) exports reusable error classes and/or middleware.
**Evidence:** Glob for `server/**/error*.ts`; confirm at least one utility file exists.

### VAL-FOUND-046: Server has typed API error classes
Custom error classes (e.g., `NotFoundError`, `ValidationError`, `ConflictError`) exist that extend a base `AppError` class with HTTP status codes.
**Evidence:** Read the error utility file; confirm class hierarchy with `statusCode` property.

### VAL-FOUND-047: Server routes use shared error classes
API routes in `server/api/` throw typed errors (e.g., `throw new NotFoundError(…)`) instead of inline `res.status(404).json(…)`.
**Evidence:** Grep `server/api/` for `new.*Error` and reduced usage of direct `res.status(4xx)` patterns.

### VAL-FOUND-048: Server has centralized error-handling middleware
An Express error-handling middleware in `server/index.ts` (or imported from a shared module) catches errors, formats consistent JSON responses, and logs via pino.
**Evidence:** Read `server/index.ts`; confirm `app.use((err, req, res, next) => …)` middleware exists after routes.

### VAL-FOUND-049: Server error responses have consistent shape
All error responses follow a consistent JSON shape, e.g., `{ error: string, code?: string, details?: unknown }`.
**Evidence:** Review error middleware; confirm uniform response format.

---

## I. Shared Error Handling Utilities — Python

### VAL-FOUND-050: Python error exception hierarchy is complete
`python/core/errors/exceptions.py` defines a `BotException` base class with at least `RecoverableError` and `FatalError` subclasses covering all known failure modes.
**Evidence:** Read `python/core/errors/exceptions.py`; confirm the hierarchy. Current state already passes (12 exception classes exist).

### VAL-FOUND-051: Python error handler classifies all known exception types
`python/core/errors/handler.py` `classify_exception()` handles `AccountBannedException`, `LoginRequiredException`, `FatalError`, `RateLimitException`, `TransientError`, `NetworkError`, `ProxyError`, `PlaywrightTimeoutError`, `StaleStateError`, `ElementNotFoundError`, `SelectorTimeoutError`, and a default case.
**Evidence:** Read `handler.py`; confirm all exception types from `exceptions.py` have classification branches.

### VAL-FOUND-052: Python retry decorator exists and is used
`python/core/errors/retry.py` exports `retry_with_backoff` decorator with configurable max retries and exponential backoff.
**Evidence:** Read `retry.py`; grep for `@retry_with_backoff` usage in `python/`.

### VAL-FOUND-053: Python safe_action decorator exists and is used
`python/core/errors/safe_action.py` exports `safe_action` decorator that catches non-fatal errors with logging.
**Evidence:** Read `safe_action.py`; grep for `@safe_action` usage in `python/`.

### VAL-FOUND-054: Python circuit breaker is functional
`python/core/errors/http_client.py` `CircuitBreaker` class transitions between closed, open, and half-open states correctly.
**Evidence:** Unit test or code review confirming: (a) `record_failure()` opens circuit at threshold, (b) `check_state()` raises after open, (c) recovery timeout allows half-open probe.

### VAL-FOUND-055: Python resilience config is centralized
`python/core/errors/config.py` `ResilienceConfig` dataclass is the single source of truth for retry/backoff/circuit-breaker parameters. No magic numbers elsewhere.
**Evidence:** Grep `python/` for hardcoded retry counts or backoff values outside of `config.py`.

---

## J. Shared Error Handling Utilities — Frontend

### VAL-FOUND-056: Frontend ErrorBoundary catches and reports errors
`frontend/src/components/shared/ErrorBoundary.tsx` catches render errors via `componentDidCatch` and reports them to Sentry.
**Evidence:** Read the file; confirm `Sentry.captureException` call.

### VAL-FOUND-057: Frontend route-level ErrorBoundary exists
`frontend/src/root.tsx` exports an `ErrorBoundary` function that renders a user-friendly error UI via `RouteErrorView`.
**Evidence:** Read `root.tsx`; confirm `export function ErrorBoundary()` exists.

### VAL-FOUND-058: No raw console.error in frontend production code
Frontend source files under `frontend/src/` (excluding test/script files) do not use `console.log` / `console.error` for error reporting. Errors go through Sentry or are removed.
**Evidence:** `rg 'console\.(log|error|warn)' frontend/src/ --glob '!scripts/*'` returns zero matches (or only acceptable dev-mode guards).

---

## K. Build & Lint Verification

### VAL-FOUND-059: Server builds without errors
`npm --prefix server run build` completes with exit code 0 and no TypeScript errors.
**Evidence:** Run command; confirm clean exit.

### VAL-FOUND-060: Frontend builds without errors
`npm --prefix frontend run build` completes with exit code 0.
**Evidence:** Run command; confirm clean exit.

### VAL-FOUND-061: Frontend lint passes
`npm --prefix frontend run lint` completes with zero errors.
**Evidence:** Run command; confirm clean output.

### VAL-FOUND-062: Frontend typecheck passes
`npm --prefix frontend run typecheck` completes with zero errors.
**Evidence:** Run command; confirm clean output.

### VAL-FOUND-063: Python tests pass
`python -m pytest python/tests -q` passes with zero failures.
**Evidence:** Run command; confirm all tests pass.

### VAL-FOUND-064: Convex tests pass
`npm run test:convex` passes with zero failures.
**Evidence:** Run command; confirm clean exit.

---

## L. Integration & Cross-Cutting Concerns

### VAL-FOUND-065: Sentry DSN is in .env.example but not in .env
`.env.example` (or equivalent template) contains `SENTRY_DSN=` placeholder. Actual `.env` and `.env.local` are in `.gitignore` and never committed.
**Evidence:** Read `.env.example`; confirm `.gitignore` includes `.env` and `.env.local`.

### VAL-FOUND-066: Docker build succeeds with Foundation changes
`docker compose build` completes successfully, incorporating the new `sentry-sdk` dependency in the Python container and any new npm packages in server/frontend.
**Evidence:** Run `docker compose build`; confirm exit code 0.

### VAL-FOUND-067: No secrets in committed source
No Sentry DSNs, auth tokens, or API keys are hardcoded anywhere in tracked files.
**Evidence:** `rg '(sntrys_|https://.*@.*sentry\.io)' --glob '!.env*' --glob '!node_modules'` returns zero matches.

### VAL-FOUND-068: Python logging setup is idempotent
Calling `setup_logging()` multiple times does not create duplicate handlers or duplicate log lines.
**Evidence:** Unit test or code review confirming handler deduplication logic (e.g., checking `logging.root.handlers` before adding).

### VAL-FOUND-069: Server logger includes request context
The pino logger (or a middleware wrapper) attaches request ID, method, URL, and response status to log entries for HTTP requests.
**Evidence:** Read logger configuration or middleware; confirm `req.id`, `req.method`, `req.url` appear in structured log output.

### VAL-FOUND-070: Error handling gracefully degrades when Sentry DSN is absent
If `SENTRY_DSN` is unset or empty, `Sentry.init()` in all three platforms (frontend, server, Python) does not throw and the application starts normally — Sentry is simply disabled.
**Evidence:** Confirm `Sentry.init({ dsn: undefined })` or `sentry_sdk.init(dsn=None)` is safe (Sentry SDK documented behavior). Optionally guarded with an `if` check.
