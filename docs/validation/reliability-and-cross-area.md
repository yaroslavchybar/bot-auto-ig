# Validation Assertions: Reliability & Cross-Area

---

## Reliability Assertions

### VAL-REL-001 — Graceful Shutdown on SIGTERM / SIGINT (Server)

**Description:** When the Express server process receives `SIGTERM` or `SIGINT`, every registered cleanup function in `server/automation/shutdown.ts` executes before the process exits. No orphaned Python child processes remain.

**Pass condition:**
1. Send `SIGTERM` to the server while automation is running.
2. All registered `cleanupFns` run (verified via log output or test spy).
3. The child Python process terminates (PID file is cleared, `ps` shows no orphan).
4. Process exits with code `0`.

**Fail condition:** Any cleanup function is skipped, a Python child survives after server exit, or the process exits with a non-zero code without an explicit fatal error.

**Evidence:**
- Unit/integration test that registers mock cleanup functions, triggers `SIGTERM`, and asserts all were called.
- Manual or CI test showing no orphaned PIDs after `kill <server-pid>`.
- `server/automation/process-manager.ts` `clearPid()` is invoked during shutdown.

---

### VAL-REL-002 — Graceful Shutdown (Python Automation)

**Description:** When the Python runner receives a termination signal or its parent server process dies, it performs orderly cleanup: persists current state via `save_state()`, closes Playwright browser contexts, and releases any OS resources (job objects on Windows).

**Pass condition:**
1. Kill the Python process while mid-action.
2. `data/session_state.json` contains a valid snapshot with `profile`, `action`, `progress`, and `timestamp` fields.
3. No zombie browser processes remain.

**Fail condition:** State file is missing, corrupt, or empty after kill. Browser processes linger.

**Evidence:**
- `python/tests/test_state_persistence.py` passes (save/load/clear round-trip).
- `python/tests/test_process_cleanup.py` passes (no zombie child processes).
- `python/tests/test_job_object.py` passes on Windows (job object terminates children).

---

### VAL-REL-003 — Server→Convex Retry with Exponential Backoff

**Description:** Every HTTP call from the Express server to Convex (via `server/data/convex.ts` `convexFetch`) retries on transient failures (network errors, HTTP 5xx, 429) using exponential backoff with jitter. Retries are configurable (max attempts, base delay).

**Pass condition:**
1. Stub the Convex endpoint to return HTTP 503 for the first N requests, then 200.
2. The call succeeds after retries without throwing.
3. Delays between retries grow exponentially (measurable via timestamps).
4. Jitter variance is non-zero (delays are not identical across runs).

**Fail condition:** A transient 5xx causes an immediate unretried crash. Retries use fixed delays. Non-retryable errors (4xx except 429) are retried.

**Evidence:**
- Integration test or unit test with HTTP stub covering 503→200 scenario.
- Code review confirms backoff formula: `baseDelay * 2^attempt + jitter`.
- Configuration constants for `maxRetries`, `baseDelay` are present and documented.

---

### VAL-REL-004 — Python→Convex Retry with Circuit Breaker

**Description:** The Python `ResilientHttpClient` (in `python/core/errors/http_client.py`) retries transient failures with exponential backoff and opens a circuit breaker after repeated failures to avoid flooding a degraded Convex service.

**Pass condition:**
1. Simulate 5 consecutive failures → circuit breaker opens (`CircuitBreakerOpenError` raised on next call).
2. After `recovery_timeout` seconds, a probe request is allowed (half-open state).
3. If probe succeeds, circuit closes and normal traffic resumes.
4. If probe fails, circuit stays open for another timeout period.

**Fail condition:** Circuit never opens despite repeated failures. Circuit stays permanently open after recovery timeout. `calculate_sleep_time` produces negative or zero values.

**Evidence:**
- `python/tests/test_http_client.py` covers open/half-open/closed transitions.
- `python/tests/test_retry.py` validates `calculate_sleep_time` produces positive, increasing values with jitter.
- Code review: `CircuitBreaker.check_state()` correctly compares elapsed time to `recovery_timeout`.

---

### VAL-REL-005 — Frontend→Server API Call Retry

**Description:** Frontend HTTP calls to the Express server retry on transient failures (network errors, HTTP 5xx, 429) with backoff. The user sees a loading/retry state rather than an immediate error screen.

**Pass condition:**
1. Stub a server endpoint to fail twice with 503, then succeed.
2. The frontend hook/fetch wrapper retries transparently.
3. The UI shows a loading or "retrying" indicator, not an error toast, during retries.
4. After max retries exhausted, a user-friendly error message is displayed.

**Fail condition:** A single transient failure shows an error toast/screen immediately. No retry is attempted. Retry count is unbounded.

**Evidence:**
- Frontend fetch wrapper/hook includes retry logic with configurable `maxRetries`.
- UI test or Storybook story showing retry state.
- Code review confirms non-retryable errors (401, 403, 404) are not retried.

---

### VAL-REL-006 — WebSocket Auto-Reconnect with Exponential Backoff

**Description:** The frontend `useWebSocket` hook (in `frontend/src/hooks/useWebSocket.ts`) automatically reconnects on disconnection using exponential backoff with jitter, capped at a maximum delay.

**Pass condition:**
1. Disconnect the WebSocket server (or simulate `onclose`).
2. The hook schedules reconnection with increasing delays: `1s → 2s → 4s → … → 30s` (cap).
3. Jitter is applied (20% variance per current implementation).
4. On successful reconnect, `reconnectAttemptRef` resets to 0.
5. `connected` state toggles correctly (`true` → `false` → `true`).

**Fail condition:** Reconnection delay is constant. Delay exceeds `MAX_RECONNECT_DELAY` (30s). Attempt counter does not reset on success. Multiple WebSocket connections are opened simultaneously.

**Evidence:**
- `getReconnectDelay(attempt)` unit test verifying exponential growth and cap.
- `useWebSocket` integration test simulating disconnect/reconnect cycle.
- Code review confirms `BASE_RECONNECT_DELAY = 1000`, `MAX_RECONNECT_DELAY = 30000`, jitter = `delay * 0.2 * random()`.

---

### VAL-REL-007 — Concurrent Process Management Safety (Mutex)

**Description:** The `automationMutex` (in `server/helpers/mutex.ts`) prevents race conditions when multiple API requests attempt to start/stop automation simultaneously. Only one automation operation proceeds at a time; others queue.

**Pass condition:**
1. Send two simultaneous "start automation" requests.
2. Only one acquires the mutex; the second waits.
3. The first completes and releases; the second then proceeds (or returns a conflict error).
4. No duplicate Python processes are spawned.

**Fail condition:** Two automation processes start concurrently. Mutex deadlocks (never releases). A queued request waits indefinitely without timeout.

**Evidence:**
- Unit test: two concurrent `mutex.acquire()` calls — second resolves only after first releases.
- Integration test: concurrent `/api/automation/start` requests — only one PID is saved.
- Code review: `automationMutex` is used in all start/stop code paths in `server/api/automation.ts`.

---

### VAL-REL-008 — In-Memory & File-Based State Persistence for Restart Survival

**Description:** Server automation state (`server/automation/state.ts`) is persisted to `server/data/automation_state.json` on every state transition. On restart, `detectInterruptedRun()` detects and recovers from interrupted runs.

**Pass condition:**
1. Start automation → `markStarted(pid, settings)` writes state file with `status: "running"`.
2. Kill the server process (simulating crash).
3. Restart the server → `detectInterruptedRun()` returns the interrupted state.
4. Orphaned process cleanup runs via `cleanupOrphanedProcesses()`.
5. After cleanup, state resets to idle.

**Fail condition:** State file is not written on start. Restart does not detect the interrupted run. Orphan PID is not killed. State file contains invalid JSON after atomic write.

**Evidence:**
- Unit test: `saveState` / `loadState` / `detectInterruptedRun` round-trip.
- `python/core/storage/atomic.py` `atomic_write_json` test covering crash-during-write (temp file cleanup).
- `python/tests/test_state_persistence.py` passes.
- Integration test: kill server mid-run, restart, verify recovery.

---

### VAL-REL-009 — Circuit Breaker for External Service Calls (Python)

**Description:** All Python HTTP calls to external services (Convex, proxied Instagram endpoints) go through `ResilientHttpClient`, which wraps a `CircuitBreaker`. When the circuit is open, calls fail fast with `CircuitBreakerOpenError` instead of hanging.

**Pass condition:**
1. After `threshold` (default 5) consecutive failures, `circuit_breaker.is_open` is `True`.
2. Subsequent calls raise `CircuitBreakerOpenError` immediately (no network request).
3. After `recovery_timeout` (default 60s), one probe request is allowed.
4. Success on probe closes the circuit.

**Fail condition:** Calls still attempt network requests when circuit is open. Circuit breaker state leaks between different client instances unexpectedly. `record_success` does not reset `failure_count`.

**Evidence:**
- `python/tests/test_http_client.py` with mock server returning 500s.
- Code review: `_http_client` in `python/database/client.py` is a module-level singleton (`ResilientHttpClient()`), so circuit state persists.
- Configuration values (`threshold`, `recovery_timeout`) are documented.

---

### VAL-REL-010 — Convex Downtime Handling

**Description:** When the Convex backend is unreachable, the system degrades gracefully: the server returns appropriate error responses to the frontend (not 500 stack traces), the Python runner pauses and retries (does not crash), and the frontend displays a meaningful offline banner.

**Pass condition:**
1. Block Convex URL at network level (or stub to timeout).
2. Server API endpoints return `{ success: false, error: { code: "EXTERNAL_SERVICE_ERROR", message: "..." } }`.
3. Python `ConvexError` is raised and handled by the error handler (`classify_exception` routes it appropriately).
4. Frontend shows a "backend unavailable" or equivalent message, not a raw error.

**Fail condition:** Unhandled exception crashes the server. Python runner exits on first Convex failure. Frontend shows a blank page or raw JSON error.

**Evidence:**
- Server error response uses `ErrorCodes.EXTERNAL_SERVICE_ERROR` from `server/helpers/errors.ts`.
- Python error handler classifies `ConvexError` → `ErrorDecision.RETRY` or `ABORT` depending on severity.
- Frontend error boundary or toast handler catches and displays the error.
- Integration test with stubbed Convex returning 503 for all endpoints.

---

### VAL-REL-011 — Error Classification and Recovery Strategy (Python)

**Description:** The Python error handler (`python/core/errors/handler.py`) correctly classifies every known exception type into one of four recovery strategies: `RETRY`, `RESTART_BROWSER`, `BACKOFF_AND_SLOW`, or `ABORT`.

**Pass condition:**
1. `AccountBannedException` → `ABORT`
2. `LoginRequiredException` → `ABORT`
3. `RateLimitException` → `BACKOFF_AND_SLOW`
4. `TransientError`, `NetworkError`, `ProxyError`, `PlaywrightTimeoutError` → `RETRY`
5. `StaleStateError` → `RESTART_BROWSER`
6. `ElementNotFoundError`, `SelectorTimeoutError` → `RETRY`
7. Playwright `"Target closed"` error → `RESTART_BROWSER`
8. Unknown `Exception` → `ABORT`

**Fail condition:** Any exception type maps to the wrong decision. A new custom exception is added without updating the classifier.

**Evidence:**
- `python/tests/test_error_handler.py` covers every branch with explicit assertions.
- Code review: no exception subclass is unhandled.

---

### VAL-REL-012 — Atomic File Writes Prevent Corruption

**Description:** All JSON state files (`session_state.json`, `automation_state.json`, selector cache) are written atomically via `atomic_write_json` (temp file + `os.replace`). Interrupted writes do not corrupt the target file.

**Pass condition:**
1. Simulate a crash (exception) mid-write.
2. The original file remains intact (previous valid content).
3. No orphaned `.tmp` files remain in the directory.
4. On Windows, retry logic handles filesystem locking (up to `max_retries` attempts).

**Fail condition:** Target file is truncated or contains partial JSON after interrupted write. Temp files accumulate on disk.

**Evidence:**
- Unit test: inject exception after `json.dump` but before `os.replace` — original file unchanged.
- `python/tests/test_state_persistence.py` and `python/tests/test_selector_cache.py` validate round-trip integrity.
- Code review: `atomic_write_json` cleanup block removes temp file on failure.

---

## Cross-Area Assertions

### VAL-CROSS-001 — Application Starts and Serves Pages After All Refactoring

**Description:** After all refactoring milestones are complete, the full application stack starts successfully: Convex backend responds, Express server starts and binds its port, frontend builds without errors and renders the landing page, WebSocket connects.

**Pass condition:**
1. `npm run build` (root) exits with code 0.
2. `npm --prefix frontend run build` exits with code 0.
3. `npm --prefix server run build` exits with code 0.
4. `npm run dev` (root) starts without errors; server logs show "listening on port 3001" (or configured port).
5. `GET /` on the frontend returns HTTP 200 with valid HTML.
6. WebSocket connection to `/ws` succeeds (with valid auth token).
7. At least one API endpoint (e.g., `GET /api/profiles`) returns `{ success: true, data: [...] }`.

**Fail condition:** Any build step fails. Server crashes on startup. Frontend renders a blank page or error boundary. WebSocket connection is refused.

**Evidence:**
- CI pipeline green on `main` branch after final merge.
- Screenshot or response body of the rendered landing page.
- `curl` output for `/api/profiles` showing success response.
- WebSocket connect log showing `[WS] Client connected (authenticated)`.

---

### VAL-CROSS-002 — Sentry End-to-End Error Reporting

**Description:** Errors originating in any layer (frontend React, Express server, Python automation) are captured and appear in Sentry with correct source maps, tags, and context.

**Pass condition:**
1. **Frontend:** Trigger an unhandled React error → event appears in Sentry with component stack, source-mapped file/line, and `environment` tag.
2. **Server:** Throw an unhandled exception in an Express route → event appears in Sentry with request URL, method, and stack trace.
3. **Python:** Raise an unhandled exception in a runner → event appears in Sentry with Python traceback, `profile_name` tag, and `action` context.

**Fail condition:** Error is swallowed silently (no Sentry event). Source maps are missing (minified stack trace). Tags/context fields are absent.

**Evidence:**
- Sentry project dashboard showing at least one test event from each layer with correct metadata.
- `SENTRY_DSN` environment variable is set in `.env` for all three layers.
- Sentry SDK initialization code exists in: frontend entry point, server `index.ts`, and Python `setup_logging` or dedicated Sentry init module.
- Source maps are uploaded during build (frontend) or inline (server).

---

### VAL-CROSS-003 — Consistent English-Only JSON Logging Across All Layers

**Description:** All log output across frontend (browser console in production), server (Express stdout/file), and Python (file + stdout) follows a consistent JSON structure with English-only messages. No Ukrainian, Russian, or other non-English strings appear in log output.

**Pass condition:**
1. **Python:** `JsonFormatter` in `python/core/logging.py` outputs `{"timestamp", "level", "logger", "message", "module", "line"}` — all values are English strings.
2. **Server:** Log entries broadcast via WebSocket and written by `appendFileLog` use the schema: `{message, level, source, profileName?, workflowId?, ...}` — all English.
3. **Frontend:** No `console.log` with non-English strings in production code.
4. Grep across entire codebase for Cyrillic characters in log strings returns zero hits (excluding data files, user content, and comments).

**Fail condition:** Any log message contains non-English text. JSON structure differs between layers (e.g., `level` vs `severity`, `timestamp` vs `ts`). A `print()` statement bypasses the structured logger in Python.

**Evidence:**
- `rg '[а-яА-ЯіІїЇєЄґҐ]' --glob '*.py' --glob '*.ts' --glob '*.tsx'` returns zero matches in log/error message strings.
- Python `JsonFormatter` test validating output schema.
- Server log sample showing valid JSON structure.
- No raw `print()` calls remain in Python automation code (all replaced with `logger.*`).

---

### VAL-CROSS-004 — No File Exceeds 800 Lines

**Description:** Every source file in the project (TypeScript, TSX, Python, Convex) is at most 800 lines long, enforcing modularity and readability.

**Pass condition:**
1. Run line-count check: `find . -name '*.ts' -o -name '*.tsx' -o -name '*.py' | xargs wc -l | awk '$1 > 800'` returns zero results (excluding generated files like `convex/_generated/*` and `node_modules`).
2. No new file introduced during refactoring exceeds 800 lines.

**Fail condition:** Any non-generated source file exceeds 800 lines.

**Evidence:**
- CI lint step or pre-commit hook enforcing `max-lines: 800`.
- Output of line-count script showing all files ≤ 800 lines.
- Exclusion list documented: `convex/_generated/`, `node_modules/`, `dist/`, `.git/`.

---

### VAL-CROSS-005 — No Function Exceeds 80 Lines

**Description:** Every function or method in the project is at most 80 lines long, ensuring single-responsibility and testability.

**Pass condition:**
1. Static analysis or AST-based check across all `.ts`, `.tsx`, and `.py` files shows no function body exceeds 80 lines.
2. React component render functions (JSX return) count toward the component function's line count.

**Fail condition:** Any function or method body exceeds 80 lines (excluding blank lines and comments, or including them — whichever the team decides, but the rule must be consistent).

**Evidence:**
- ESLint rule `max-lines-per-function: [error, { max: 80 }]` configured and passing.
- Python linting rule (pylint `max-statements` or custom AST check) configured and passing.
- CI output showing zero violations.

---

### VAL-CROSS-006 — DDD Structure Consistency Between Server and Python

**Description:** Both the Express server and Python automation follow the same Domain-Driven Design layering: **API/Entrypoint → Domain/Service → Data/Infrastructure**. Directory names and import directions are consistent.

**Pass condition:**
1. **Server** follows: `server/api/` (routes/controllers) → `server/automation/` + `server/helpers/` (domain logic) → `server/data/` (Convex client, persistence).
2. **Python** follows: `python/runners/` (entrypoints) → `python/actions/` (domain logic) → `python/database/` (Convex client) + `python/core/` (infrastructure).
3. No circular imports: API layer does not import from data layer directly (goes through domain). Data layer does not import from API layer.
4. Import direction is strictly downward: `api → domain → data/infra`.

**Fail condition:** A route handler in `server/api/` directly calls `convexFetch`. A Python runner in `python/runners/` directly calls `requests.get()` bypassing the resilient client. Circular dependency detected.

**Evidence:**
- Dependency graph generated via `madge` (TS) or `pydeps` (Python) showing no cycles.
- Code review checklist confirming import direction.
- Grep for `convexFetch` usage — only in `server/data/*.ts`.
- Grep for `requests.get` / `requests.post` — only in `python/core/errors/http_client.py` and `python/core/process/healthcheck.py` (infrastructure layer).

---

### VAL-CROSS-007 — All Builds and Tests Pass

**Description:** After all refactoring is complete, every build, lint, and test command defined in the project passes with zero errors.

**Pass condition:**
1. `npm run build` — exit code 0.
2. `npm --prefix frontend run build` — exit code 0.
3. `npm --prefix frontend run lint` — exit code 0, zero warnings treated as errors.
4. `npm --prefix server run build` — exit code 0.
5. `npm run test:convex` — all tests pass.
6. `python -m pytest python/tests -q` — all tests pass, zero failures.
7. `docker compose up --build` — containers start without error (if applicable).

**Fail condition:** Any command exits with non-zero code. Any test is skipped without documented reason. A lint warning is suppressed without a code comment explaining why.

**Evidence:**
- CI pipeline summary showing all green checks.
- Terminal output / log artifact for each command.
- Test count summary (e.g., "42 passed, 0 failed, 0 skipped").

---

### VAL-CROSS-008 — Consistent Error Response Format Across Server API

**Description:** Every Express API endpoint returns errors using the standardized format from `server/helpers/errors.ts`: `{ success: false, error: { code: string, message: string } }`. No endpoint returns raw strings, stack traces, or non-standard error shapes.

**Pass condition:**
1. Every `catch` block in `server/api/*.ts` uses `errorResponse(code, message)`.
2. Error codes come from the `ErrorCodes` enum.
3. No endpoint returns `res.status(500).send(err.message)` or similar raw patterns.
4. HTTP status codes match error semantics: 400 for validation, 404 for not found, 409 for conflict, 500 for internal.

**Fail condition:** Any endpoint returns a non-standard error shape. A raw error message or stack trace leaks to the client. An error code is a free-form string not in `ErrorCodes`.

**Evidence:**
- Grep across `server/api/` for `res.status(` — every instance uses `errorResponse()` or `successResponse()`.
- Integration test sending invalid input to each endpoint and asserting response shape.
- Code review: no `res.json({ error: "..." })` patterns (must be `res.json(errorResponse(...))`.

---

### VAL-CROSS-009 — Frontend Error Boundaries Prevent Blank Pages

**Description:** The React frontend has error boundaries at route and feature levels. An error in one feature (e.g., profiles page) does not crash the entire app — other routes remain navigable.

**Pass condition:**
1. An error thrown in the Profiles page component is caught by its error boundary.
2. The user sees a friendly error message with a "retry" or "go home" action.
3. Navigating to another route (e.g., Workflows) works normally.
4. The error is reported (console in dev, Sentry in production).

**Fail condition:** An error in one route crashes the entire app (white screen). Error boundary shows a raw stack trace to the user. Navigation is broken after an error.

**Evidence:**
- React Router 7 `errorElement` or `ErrorBoundary` configured at route level in `routes.ts`.
- Manual or automated test: inject `throw new Error('test')` in a page loader → error boundary renders.
- Screenshot showing error boundary UI.

---

### VAL-CROSS-010 — No Secrets in Source Code or Logs

**Description:** No API keys, tokens, passwords, or DSN strings appear in committed source code, build output, or log output. All secrets come from environment variables loaded via `.env` / `.env.local`.

**Pass condition:**
1. `rg -i '(api_key|secret_key|password|token|dsn)\s*=' --glob '*.ts' --glob '*.tsx' --glob '*.py'` returns only references to `process.env.*` or `os.environ.*`, never literal values.
2. `.env` and `.env.local` are in `.gitignore`.
3. Log output does not contain any environment variable values (especially `CLERK_SECRET_KEY`, `INTERNAL_API_KEY`, `CONVEX_URL`).
4. `git log --all -p | grep -i 'sk_live\|sk_test\|Bearer '` returns zero matches of actual secret values.

**Fail condition:** A secret value is hardcoded. `.env` is committed. A log statement prints an API key or token.

**Evidence:**
- `.gitignore` contains `.env` and `.env.local`.
- Grep results showing only `process.env.X` references.
- Code review: no `console.log(apiKey)` or `logger.info(f"token={token}")` patterns.
