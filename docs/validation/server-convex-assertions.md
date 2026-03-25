# Validation Assertions — Server & Convex

> Area: Server (Express 4) + Convex backend
> Prefix: `VAL-SRVC-` (server), `VAL-CNVX-` (convex)

---

## Server Assertions

### VAL-SRVC-001 — DDD Folder Structure

**Description:** The `server/` directory uses a domain-grouped structure with top-level folders for each bounded context (`profiles/`, `workflows/`, `automation/`, `monitoring/`, `lists/`, `logs/`, `displays/`) plus cross-cutting `shared/` (or `common/`). The legacy layer-based folders (`api/`, `data/`, `helpers/`, `types/`) no longer exist.

**Pass condition:**
- Each domain folder exists and contains its own route, service, and data-access modules.
- No files remain in `server/api/`, `server/data/`, `server/helpers/`, or `server/types/` directories.
- `server/security/` may persist as a cross-cutting concern folder.

**Evidence:**
- Directory listing of `server/` shows only domain and shared folders.
- `ls server/api` returns "not found" or directory does not exist.

---

### VAL-SRVC-002 — File Size Limit (800 Lines)

**Description:** Every `.ts` file under `server/` is at most 800 lines of code.

**Pass condition:** `find server/ -name '*.ts' | xargs wc -l` shows no file exceeding 800 lines.

**Fail condition:** Any `.ts` file under `server/` has > 800 lines.

**Evidence:** Line-count report for all `server/**/*.ts` files, sorted descending. Specific attention to successors of `api/profiles.ts` (was 537 lines) and `api/workflows.ts` (was 463 lines).

---

### VAL-SRVC-003 — Function Size Limit (80 Lines)

**Description:** No single exported or named function in `server/` exceeds 80 lines.

**Pass condition:** Static analysis or grep-based measurement confirms every function body is ≤ 80 lines.

**Fail condition:** Any function body exceeds 80 lines.

**Evidence:** Automated scan output (e.g., ESLint `max-lines-per-function` rule or custom script) reporting zero violations.

---

### VAL-SRVC-004 — No console.log Remaining

**Description:** All logging in `server/` uses the pino structured logger. No `console.log`, `console.error`, or `console.warn` calls remain in production source files.

**Pass condition:** `rg 'console\.(log|error|warn)' server/ --glob '*.ts' --glob '!*.test.ts'` returns zero matches.

**Fail condition:** Any match found in non-test `.ts` files under `server/`.

**Evidence:** ripgrep output showing zero results. Previously there were 40+ `console.*` calls across `websocket.ts`, `security/auth.ts`, `index.ts`, `data/profiles.ts`, `automation/state.ts`, `automation/process-manager.ts`, and `api/profiles.ts`.

---

### VAL-SRVC-005 — Pino Logger Exists and Is Imported

**Description:** A shared pino logger instance is defined in a single module (e.g., `server/shared/logger.ts` or `server/common/logger.ts`) and imported by all modules that perform logging.

**Pass condition:**
- A logger module exists exporting a configured pino instance.
- Every file that previously called `console.*` now imports from the logger module.

**Evidence:** Logger module source file + grep showing import usage across server modules.

---

### VAL-SRVC-006 — Global Express Error Handler

**Description:** A global Express error-handling middleware (`(err, req, res, next)`) is registered in `server/index.ts` (or the app bootstrap file) as the last middleware. It catches all unhandled route errors and returns a consistent `ApiErrorResponse` shape.

**Pass condition:**
- A 4-argument Express middleware is registered after all routes.
- It uses `errorResponse()` from the standardized helpers.
- It returns appropriate HTTP status codes (not always 500).

**Fail condition:** No global error handler exists, or individual routes still have their own try/catch blocks that could be delegated.

**Evidence:** Source of the error handler middleware + `server/index.ts` showing registration order.

---

### VAL-SRVC-007 — Consistent Error Response Shape

**Description:** All API error responses conform to the `ApiErrorResponse` interface: `{ success: false, error: { code: string, message: string } }`. No route returns a bare `{ error: string }` object.

**Pass condition:** `rg '\.json\(\s*\{\s*error:' server/ --glob '*.ts' --glob '!*.test.ts'` returns zero matches (all errors go through `errorResponse()` or the global handler).

**Fail condition:** Any route handler returns a raw `{ error: "..." }` JSON response. Previously found in `api/workflows.ts`, `api/profiles.ts`, and others.

**Evidence:** ripgrep output + review of all `res.status(...).json(...)` call sites.

---

### VAL-SRVC-008 — ProcessService Exists

**Description:** A reusable `ProcessService` (or equivalent) class/module encapsulates all Python child-process spawning logic (spawn, kill, PID tracking, cleanup). It is the single place where `child_process.spawn` is called for automation runners.

**Pass condition:**
- A `ProcessService` module exists under `server/shared/` or `server/automation/`.
- It exports functions for spawn, kill, and PID management.
- No other module directly imports `spawn` from `child_process` for runner processes.

**Fail condition:** `spawn` is imported in more than one module (previously duplicated in `api/automation.ts`, `api/profiles.ts`, `api/workflows.ts`, `automation/manual-actions.ts`).

**Evidence:** `rg "from 'child_process'" server/` shows only the ProcessService file (plus possibly test files). All call sites import from ProcessService.

---

### VAL-SRVC-009 — No Duplicate Process-Spawning Code

**Description:** The previously duplicated pattern of spawning a Python process with env vars, stdio, and event listeners exists in exactly one location (ProcessService).

**Pass condition:** The spawn-with-env-and-listeners pattern appears only once in the codebase. All callers delegate to `ProcessService`.

**Fail condition:** The spawn pattern (spawn + env merging + stdio config + on('close') listener) appears in multiple files.

**Evidence:** Code search for `spawn('python'` or `spawn(python,` shows a single definition site.

---

### VAL-SRVC-010 — Duplicate Try/Catch Elimination

**Description:** The ~30 duplicated try/catch error handling patterns across route handlers are replaced by either (a) the global error handler with `next(err)` delegation, or (b) a shared async route wrapper (e.g., `asyncHandler`).

**Pass condition:** Route handler functions no longer contain inline try/catch blocks that call `res.status(500).json(...)`. Instead, errors propagate to the global handler.

**Fail condition:** More than 5 try/catch blocks remain in route handler files that directly send error responses.

**Evidence:** Count of try/catch blocks in route files. Previously ~30; target is near-zero in route handlers (some may remain in service-layer code for specific error wrapping).

---

### VAL-SRVC-011 — Server Build Succeeds

**Description:** `npm --prefix server run build` completes without errors after refactoring.

**Pass condition:** Exit code 0, no TypeScript compilation errors.

**Fail condition:** Any build error.

**Evidence:** Build command stdout/stderr output.

---

### VAL-SRVC-012 — Server Tests Pass

**Description:** All existing server-side tests (currently in `server/automation/event-parser.test.ts` and `server/logs/parser.test.ts`) continue to pass.

**Pass condition:** Test runner reports all tests passing with exit code 0.

**Fail condition:** Any test failure.

**Evidence:** Test runner output.

---

### VAL-SRVC-013 — Correct HTTP Status Codes in Server Routes

**Description:** Server routes use semantically correct HTTP status codes: 400 for validation errors, 404 for not-found, 409 for conflicts, 429 for rate limits, 500 for internal errors. No blanket usage of a single error code.

**Pass condition:** Review of route handlers confirms at least 3 distinct HTTP error codes used appropriately.

**Fail condition:** All error responses use the same status code (e.g., all 500 or all 400).

**Evidence:** Grep of `res.status(` calls showing distribution of status codes.

---

## Convex Assertions

### VAL-CNVX-001 — http.ts Split Into Domain Route Files

**Description:** The monolithic `convex/http.ts` (1255 lines) is split into domain-specific route modules (e.g., `convex/http/profiles.ts`, `convex/http/workflows.ts`, `convex/http/accounts.ts`, `convex/http/lists.ts`, etc.). The main `http.ts` re-exports/composes routes from domain files.

**Pass condition:**
- `convex/http.ts` is ≤ 200 lines (composition/re-export only).
- Domain route files exist under `convex/http/` or as `convex/http*.ts` siblings.
- The total line count of all split files equals approximately the original 1255 lines.

**Fail condition:** `convex/http.ts` remains > 200 lines or route definitions are not separated by domain.

**Evidence:** Line counts for `convex/http.ts` and all domain route files.

---

### VAL-CNVX-002 — profiles.ts Split Into Focused Modules

**Description:** `convex/profiles.ts` (972 lines) is split into focused modules: core CRUD, settings/configuration, sync logic, and internal mutations.

**Pass condition:**
- No single profiles-related module exceeds 400 lines.
- All existing exported functions/mutations/queries remain accessible at the same API paths.

**Fail condition:** Any single profiles module > 400 lines, or exported APIs change their public names/paths.

**Evidence:** Line counts of all profile modules + API path audit.

---

### VAL-CNVX-003 — workflows.ts Split Into Focused Modules

**Description:** `convex/workflows.ts` (904 lines) is split into focused modules: CRUD operations, execution/scheduling, status management, and migration utilities.

**Pass condition:**
- No single workflows-related module exceeds 400 lines.
- All existing exported functions remain accessible at the same API paths.

**Fail condition:** Any single workflows module > 400 lines, or exported APIs change their public names/paths.

**Evidence:** Line counts of all workflow modules + API path audit.

---

### VAL-CNVX-004 — Dual API Pattern Simplified

**Description:** The duplicated pattern of having both a public mutation (e.g., `create`) and an internal mutation (e.g., `createInternal`) with nearly identical logic is simplified. Internal mutations either delegate to shared helper functions or are consolidated.

**Pass condition:** No pair of public + internal mutations share > 50% duplicated logic. Shared logic is extracted into helper functions.

**Fail condition:** `createInternal` in `profiles.ts` still duplicates the body of `create`. Similar duplication in workflows.

**Evidence:** Diff/comparison of public vs. internal mutation pairs showing shared helper extraction.

---

### VAL-CNVX-005 — Error Categorization Fixed (Not All 400s)

**Description:** HTTP error responses in Convex route handlers use appropriate status codes (400, 404, 409, 422, 500) instead of returning 400 for all errors. Previously, all ~40 catch blocks in `http.ts` returned `jsonResponse({ error: ... }, 400)`.

**Pass condition:**
- Not-found errors return 404.
- Validation errors return 400 or 422.
- Internal/unexpected errors return 500.
- Conflict errors return 409.
- At least 3 distinct error status codes are used across route handlers.

**Fail condition:** `rg 'jsonResponse.*400' convex/` shows more than 5 generic 400 catch-all error responses.

**Evidence:** Grep of all `jsonResponse(` calls with their status codes, showing variety. Previously 40+ lines returned blanket 400.

---

### VAL-CNVX-006 — All Existing Convex Tests Pass

**Description:** All 58 existing Convex tests (run via `npm run test:convex`) continue to pass without modification (or with only import-path updates if modules moved).

**Pass condition:** `npm run test:convex` exits with code 0 and reports 58 (or more) tests passing.

**Fail condition:** Any test failure or test count decrease below 58.

**Evidence:** Full test runner output showing pass count and exit code.

---

### VAL-CNVX-007 — HTTP Routes Organized by Domain

**Description:** HTTP route registrations (`http.route(...)`) are grouped by domain in separate files rather than in one monolithic file. Each domain file handles its own CORS preflight and route registration.

**Pass condition:**
- Route registrations for profiles, workflows, accounts, lists, keywords, and message-templates are in separate files.
- The main `http.ts` composes all domain routers.
- Previously 55+ `http.route()` calls in one file are now distributed.

**Fail condition:** More than 10 `http.route()` calls remain in the main `http.ts` composition file.

**Evidence:** Count of `http.route(` per file across all Convex HTTP modules.

---

### VAL-CNVX-008 — Shared Error Handling Utility

**Description:** A shared error-handling utility (e.g., `withErrorHandling` wrapper or `safeHandler`) replaces the repeated `try { ... } catch { return jsonResponse({error}, 400) }` pattern in HTTP action handlers.

**Pass condition:**
- A reusable error wrapper function exists.
- At least 80% of HTTP handlers use the wrapper instead of inline try/catch.
- The wrapper applies correct status code categorization (per VAL-CNVX-005).

**Fail condition:** More than 10 inline try/catch blocks remain in HTTP route handlers.

**Evidence:** Source of the error wrapper + count of inline try/catch vs. wrapped handlers.

---

### VAL-CNVX-009 — Convex Build Succeeds

**Description:** `npx convex dev --once` (or equivalent typecheck/codegen) completes without errors after refactoring.

**Pass condition:** Exit code 0, all generated types are valid.

**Fail condition:** Any type error or codegen failure.

**Evidence:** Build/codegen command output.

---

### VAL-CNVX-010 — No Broken Internal API References

**Description:** All references to internal API paths (e.g., `internalApi.profiles.createInternal`, `api.workflows.list`) resolve correctly after modules are split. No runtime "function not found" errors.

**Pass condition:**
- All `ctx.runMutation(...)`, `ctx.runQuery(...)`, and `ctx.runAction(...)` calls reference valid Convex function paths.
- Convex codegen produces correct `_generated/api.d.ts` with all expected function paths.

**Fail condition:** Any dangling reference to a moved/renamed internal function.

**Evidence:** Successful codegen output + grep for all `internalApi.` and `api.` references confirming they match generated types.

---

### VAL-CNVX-011 — Schema Unchanged

**Description:** The Convex schema (`convex/schema.ts`) is not modified during the refactoring. Table definitions, indexes, and validators remain identical.

**Pass condition:** `git diff convex/schema.ts` shows no changes (or only formatting changes with no semantic difference).

**Fail condition:** Any table, field, index, or validator change in `schema.ts`.

**Evidence:** Git diff of `convex/schema.ts`.

---

### VAL-CNVX-012 — Cron Jobs Still Functional

**Description:** Cron job definitions in `convex/crons.ts` still reference valid function paths after module splits. Scheduled workflows and cleanup routines trigger correctly.

**Pass condition:**
- `convex/crons.ts` compiles without errors.
- All referenced functions (`executeScheduledWorkflow`, `resetDailyRuns`, etc.) exist at their declared paths.

**Fail condition:** Any cron reference points to a non-existent function path.

**Evidence:** `convex/crons.ts` source + codegen validation confirming all referenced paths exist.

---

### VAL-CNVX-013 — CORS Handling Preserved

**Description:** CORS preflight handling (OPTIONS responses with `Access-Control-Allow-*` headers) continues to work for all HTTP routes after the split.

**Pass condition:**
- Every HTTP route path has a corresponding OPTIONS handler.
- CORS headers match the current set: `Allow-Origin: *`, `Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`, `Allow-Headers: Content-Type, Authorization`.

**Fail condition:** Any route path missing an OPTIONS handler, or CORS headers changed.

**Evidence:** Grep of all `OPTIONS` handler registrations + header definitions.
