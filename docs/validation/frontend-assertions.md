# Frontend Validation Assertions

> Generated: 2026-03-13
> Scope: Frontend refactoring — React Router 7 + Vite 7 dashboard

---

## VAL-FE-001 — AccountsPageContainer split into sub-components

**Title:** AccountsPageContainer decomposed below 800-line limit

**Behavioral description:**
`AccountsPageContainer.tsx` (currently 1 171 lines) is split into multiple focused sub-components and/or custom hooks. Each resulting file is ≤ 800 lines. The Accounts page renders identically: CSV upload, scraping-task list, task detail/field view, and processing flow all function as before.

**Pass condition:**
- `AccountsPageContainer.tsx` is ≤ 800 lines.
- Every file produced by the split is ≤ 800 lines.
- The Accounts route (`/accounts`) renders without runtime errors and all interactive features (mode switch, drag-drop upload, task selection, field inspection, processing) remain operational.

**Fail condition:**
- Any resulting file exceeds 800 lines, OR the Accounts page throws a runtime error, OR any interactive feature regresses.

**Evidence requirements:**
1. `wc -l` / line-count output for every new and modified file.
2. Screenshot or agent-browser smoke-test log of the `/accounts` page loading and interactive flows.
3. `npm --prefix frontend run build` exits 0.

---

## VAL-FE-002 — LogsViewer split into composable pieces

**Title:** LogsViewer decomposed below 800-line limit

**Behavioral description:**
`components/shared/LogsViewer.tsx` (currently 802 lines) is split into smaller composable pieces (e.g., log-filtering logic, log-entry row component, fetch/polling hook). Each resulting file is ≤ 800 lines and every function ≤ 80 lines. LogsViewer continues to stream, filter, and display logs on `/logs` and wherever else it is embedded (e.g., ProfileLogs).

**Pass condition:**
- `LogsViewer.tsx` is ≤ 800 lines.
- All extracted files are ≤ 800 lines, all functions ≤ 80 lines.
- Log streaming, filtering by level/source/profile, and auto-scroll work unchanged.

**Fail condition:**
- Any file exceeds 800 lines OR any function exceeds 80 lines, OR log display/filtering regresses.

**Evidence requirements:**
1. Line counts for all new/modified files.
2. Agent-browser smoke-test of `/logs` page showing log entries rendering and filters working.
3. Grep confirmation that no extracted function body exceeds 80 lines.

---

## VAL-FE-003 — All source files ≤ 800 lines

**Title:** Hard line-count ceiling enforced project-wide

**Behavioral description:**
Every `.ts` and `.tsx` file under `frontend/src/` (excluding `node_modules`, `.react-router`, `dist`) contains at most 800 lines.

**Pass condition:**
- A recursive line-count scan returns zero files exceeding 800 lines.

**Fail condition:**
- Any source file exceeds 800 lines.

**Evidence requirements:**
1. Full output of a line-count scan sorted descending, showing the top-20 files all ≤ 800.

**Current violators (baseline):**
| File | Lines |
|------|-------|
| `features/accounts/containers/AccountsPageContainer.tsx` | 1 171 |
| `components/shared/LogsViewer.tsx` | 802 |

---

## VAL-FE-004 — All functions ≤ 80 lines

**Title:** Hard function-length ceiling enforced project-wide

**Behavioral description:**
No function, arrow function, or method body in any `.ts`/`.tsx` file under `frontend/src/` exceeds 80 lines (measured from opening `{` to closing `}`). The 16+ known offenders (WorkflowsList 289, ProfilesList 287, etc.) are all brought into compliance.

**Pass condition:**
- An AST-based or regex-based function-length audit reports zero violations.

**Fail condition:**
- Any function body exceeds 80 lines.

**Evidence requirements:**
1. Output of an automated function-length scanner (ESLint `max-lines-per-function` rule or equivalent script) showing 0 violations.
2. Specific before/after line counts for the known large functions: `WorkflowsList`, `ProfilesList`, `ProfileForm`, `WorkflowDetails`, `ScheduleDialog`, `WorkflowFlowEditor`, `PythonCodeField`, `TemplateInput`.

---

## VAL-FE-005 — Duplicate getCache / setCache eliminated

**Title:** Single shared cache utility replaces duplicated implementations

**Behavioral description:**
The identical `getCache<T>` and `setCache<T>` functions currently defined independently in both `features/profiles/hooks/useProfiles.ts` (lines 17–44) and `features/lists/hooks/useLists.ts` (lines 16–43) are consolidated into a single shared module (e.g., `lib/cache.ts` or `hooks/useCache.ts`). Both consumers import from the shared location.

**Pass condition:**
- Exactly one definition of `getCache` and one of `setCache` exist in the codebase.
- `useProfiles.ts` and `useLists.ts` both import from the shared module.
- Build and lint pass.

**Fail condition:**
- More than one definition of either function exists, OR imports are broken.

**Evidence requirements:**
1. `rg "function getCache" frontend/src` returns exactly 1 result.
2. `rg "function setCache" frontend/src` returns exactly 1 result.
3. Import statements in `useProfiles.ts` and `useLists.ts` point to the shared module.

---

## VAL-FE-006 — Duplicate LogEntry type eliminated

**Title:** Single canonical LogEntry type replaces two competing definitions

**Behavioral description:**
The `LogEntry` type exported from `lib/logs.ts` (line 1) and the `LogEntry` interface exported from `hooks/useWebSocket.ts` (line 5) are consolidated into a single canonical definition. All consumers import from the single source.

**Pass condition:**
- Exactly one `LogEntry` type/interface definition exists in the codebase.
- All files that reference `LogEntry` import from the canonical location.
- TypeScript compilation succeeds with no type errors.

**Fail condition:**
- More than one definition of `LogEntry`, OR any import is broken, OR type errors arise.

**Evidence requirements:**
1. `rg "export (type|interface) LogEntry" frontend/src` returns exactly 1 result.
2. `npm --prefix frontend run typecheck` exits 0.

---

## VAL-FE-007 — Centralized error handling replaces per-container [error, setError]

**Title:** Shared error-handling pattern replaces ad-hoc useState<string | null> in containers

**Behavioral description:**
The 12+ containers/hooks that independently declare `const [error, setError] = useState<string | null>(null)` and manage their own error display are migrated to a centralized error-handling mechanism (e.g., a shared `useError` hook, an error context/provider, or toast-based error reporting via `sonner`). Individual containers no longer independently own error state for API failures.

**Pass condition:**
- A single, documented error-handling pattern is used across all container components.
- `rg "setError" frontend/src/features` returns significantly fewer independent state declarations (ideally 0 ad-hoc `useState<string | null>` for API errors).
- Error messages are still surfaced to the user on API failures.

**Fail condition:**
- Containers still independently declare and manage `[error, setError]` for generic API errors, OR errors are silently swallowed.

**Evidence requirements:**
1. Grep output showing reduced `setError` / `useState.*error` occurrences.
2. Description of the centralized pattern chosen (hook, context, or toast).
3. Smoke-test evidence that an API failure on at least one page still displays an error to the user.

---

## VAL-FE-008 — Sentry breadcrumbs integrated

**Title:** Sentry SDK installed and breadcrumbs emitted for key user actions

**Behavioral description:**
The `@sentry/react` (or equivalent) SDK is installed, initialized in the app entry point, and breadcrumbs are added for key user-facing actions: page navigation, API calls, WebSocket connect/disconnect, and error-boundary catches.

**Pass condition:**
- `@sentry/react` (or `@sentry/browser`) appears in `frontend/package.json` dependencies.
- Sentry is initialized in `entry.client.tsx` or `root.tsx` with a DSN sourced from environment config.
- `Sentry.addBreadcrumb` (or equivalent) calls exist for: navigation events, API fetch calls, WebSocket lifecycle, and error-boundary `componentDidCatch`.
- `ErrorBoundary.tsx` calls `Sentry.captureException` in `componentDidCatch`.
- Build succeeds.

**Fail condition:**
- Sentry SDK is missing, OR initialization is absent, OR no breadcrumb calls exist, OR `ErrorBoundary` does not report to Sentry.

**Evidence requirements:**
1. `package.json` diff showing Sentry dependency.
2. Grep for `Sentry.init`, `addBreadcrumb`, `captureException` with file locations.
3. `npm --prefix frontend run build` exits 0.

---

## VAL-FE-009 — Production build succeeds

**Title:** `npm --prefix frontend run build` exits 0

**Behavioral description:**
After all refactoring changes, the full frontend production build completes without errors.

**Pass condition:**
- `npm --prefix frontend run build` exits with code 0.
- No TypeScript compilation errors.
- No missing module or import errors.

**Fail condition:**
- Build exits non-zero, OR any error is printed to stderr.

**Evidence requirements:**
1. Full terminal output of `npm --prefix frontend run build` showing success.

---

## VAL-FE-010 — Lint passes

**Title:** `npm --prefix frontend run lint` exits 0

**Behavioral description:**
After all refactoring changes, ESLint reports no errors across the entire frontend source tree.

**Pass condition:**
- `npm --prefix frontend run lint` exits with code 0.
- Zero ESLint errors (warnings are acceptable).

**Fail condition:**
- Lint exits non-zero, OR any ESLint error is reported.

**Evidence requirements:**
1. Full terminal output of `npm --prefix frontend run lint`.

---

## VAL-FE-011 — TypeScript type-check passes

**Title:** `npm --prefix frontend run typecheck` exits 0

**Behavioral description:**
TypeScript strict-mode compilation across the entire frontend source tree completes with no errors.

**Pass condition:**
- `npm --prefix frontend run typecheck` exits with code 0.

**Fail condition:**
- Any `TS` error codes emitted.

**Evidence requirements:**
1. Terminal output of `npm --prefix frontend run typecheck`.

---

## VAL-FE-012 — All pages render (smoke test)

**Title:** Every route renders without white-screen or console errors

**Behavioral description:**
An agent-browser (or equivalent) smoke test navigates to every primary route and confirms each page renders its expected content without uncaught exceptions.

**Pass condition:**
All of the following routes load without a blank screen or uncaught JS error:
- `/` (index/dashboard)
- `/accounts`
- `/profiles`
- `/lists`
- `/workflows`
- `/logs`
- `/monitoring`
- `/vnc`
- `/scraped-data`

**Fail condition:**
- Any route produces a white screen, an uncaught exception in the console, or the ErrorBoundary fallback UI.

**Evidence requirements:**
1. Agent-browser screenshots or test logs for each route.
2. Console error log (should be empty of uncaught exceptions).

---

## VAL-FE-013 — No orphaned or empty directories

**Title:** Refactoring leaves no empty directories under frontend/src

**Behavioral description:**
After file moves and splits, no empty directories remain under `frontend/src/`. Any directory that lost all its files during refactoring is either repopulated or removed.

**Pass condition:**
- A recursive scan for empty directories under `frontend/src/` returns zero results.

**Fail condition:**
- Any empty directory exists.

**Evidence requirements:**
1. Output of `find frontend/src -type d -empty` (or equivalent) showing no results.

---

## VAL-FE-014 — useState call count reduced in containers

**Title:** Large containers have ≤ 5 direct useState calls after state consolidation

**Behavioral description:**
Containers that previously had 10–15+ `useState` calls (AccountsPageContainer, ProfilesPageContainer, MonitoringPageContainer, etc.) have their state consolidated via custom hooks, `useReducer`, or extracted sub-components. No single component file should have more than 5 direct `useState` declarations for its own local state (excluding hooks that internally use useState).

**Pass condition:**
- `AccountsPageContainer.tsx` has ≤ 5 `useState` calls in its component body.
- `ProfilesPageContainer.tsx` has ≤ 5 `useState` calls in its component body.
- Other large containers similarly reduced.

**Fail condition:**
- Any container component body still has > 5 direct `useState` calls.

**Evidence requirements:**
1. Grep for `useState` in each refactored container with line numbers, showing ≤ 5 per file.
2. List of extracted custom hooks and the state they encapsulate.

---

## VAL-FE-015 — React 19 patterns adopted where applicable

**Title:** Modern React 19 APIs used — `use()`, `ref` as prop

**Behavioral description:**
Where applicable, the refactored code adopts React 19 patterns:
- `use()` hook for reading promises/context where it simplifies code (e.g., replacing `useEffect` + `useState` fetch patterns).
- `ref` as a regular prop instead of `forwardRef` wrapper where components accept refs.
- `useEffectEvent` usage is reviewed and retained or expanded as appropriate (already used in `useWebSocket.ts`).

**Pass condition:**
- At least one instance of `use()` for promise/context reading exists in the refactored code.
- No remaining `forwardRef` wrappers exist for project-owned components (UI library components like Radix are excluded).
- TypeScript compilation passes with React 19 types.

**Fail condition:**
- Zero adoption of React 19-specific patterns, OR `forwardRef` still used in project-owned components that could use `ref` as prop.

**Evidence requirements:**
1. Grep for `use(` showing adoption in at least one file.
2. Grep for `forwardRef` in `frontend/src/features` and `frontend/src/components/shared` showing zero results (excluding `components/ui`).
3. Build + typecheck pass.

---

## VAL-FE-016 — No duplicate utility modules

**Title:** All shared utilities exist in exactly one location

**Behavioral description:**
Beyond the specific `getCache`/`setCache` and `LogEntry` duplicates (VAL-FE-005, VAL-FE-006), a broader audit confirms no other utility function, type, or constant is duplicated across feature boundaries. Specifically:
- `mapProfile` / `mapProfileRecord` has exactly one definition location.
- No other helper exists in both `lib/` and a feature's `utils/` with identical or near-identical implementations.

**Pass condition:**
- `mapProfileRecord` is defined in exactly one file.
- A codebase-wide audit for duplicate function names across `lib/`, `hooks/`, and `features/*/utils/` reveals no further duplicates.

**Fail condition:**
- Any utility function is defined in more than one location with substantially similar logic.

**Evidence requirements:**
1. Grep for `mapProfileRecord` showing one definition.
2. Summary of a cross-module duplicate-function audit (manual or scripted).

---

## VAL-FE-017 — Import paths are consistent and resolve correctly

**Title:** All import paths use the project's `@/` alias and resolve without errors

**Behavioral description:**
After file moves and renames, all import paths are updated. No broken imports remain. The project's `@/` path alias is used consistently (no relative `../../..` chains exceeding 2 levels).

**Pass condition:**
- `npm --prefix frontend run typecheck` exits 0 (covers broken imports).
- No import uses more than two `../` levels (prefer `@/` alias).

**Fail condition:**
- Any unresolved import, OR excessive relative path depth.

**Evidence requirements:**
1. Typecheck passing (VAL-FE-011).
2. `rg "\.\./\.\./\.\." frontend/src --glob "*.ts" --glob "*.tsx"` returns zero deep-relative imports in refactored files.

---

## VAL-FE-018 — Extracted hooks have clear single responsibility

**Title:** Custom hooks extracted during refactoring each serve a single concern

**Behavioral description:**
Hooks created to decompose large containers (e.g., `useScrapingTasks`, `useAccountUpload`, `useLogsFetch`, etc.) each own a single cohesive concern. No extracted hook has more than 80 lines or manages unrelated state domains.

**Pass condition:**
- Every new custom hook file is ≤ 80 lines for its primary export function.
- Each hook's name clearly describes its single responsibility.
- No hook manages state from two unrelated domains (e.g., mixing upload state with scraping-task state).

**Fail condition:**
- Any extracted hook exceeds 80 lines, OR mixes unrelated concerns.

**Evidence requirements:**
1. List of all new hook files with line counts.
2. Brief description of each hook's responsibility.

---

*End of frontend validation assertions.*
