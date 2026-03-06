# Verification Log

Verification date: 2026-03-05

## Integrity Checks

1. `git grep -n "file:///" -- "*.md"`
- Result: pass (`NO_FILE_URI_LINKS`)

2. Relative markdown link check (tracked markdown)
- Result: pass (`LINK_CHECK_OK_TRACKED_MD`)

3. Relative markdown link check (tracked markdown + `docs/**/*.md`)
- Result: pass (`LINK_CHECK_OK_SCOPE_ALL_DOCS`)

## Command Spot-Checks

1. Root path command:
- Command: `npm run build`
- Result: pass (`npm --prefix server run build` completed)

2. Server path command:
- Command: `npm --prefix server run build`
- Result: pass (`tsc` completed)

3. Frontend path command:
- Command: `npm --prefix frontend run build`
- Result: pass (`tsc -b && vite build` completed)
- Note: Vite emitted chunk-size advisory warning (>500 kB), build still successful.

4. Python path command:
- Command: `python -m pytest python/tests -q --collect-only`
- Result: pass (55 tests collected)
- Note: observed `pytest-asyncio` deprecation warning about default fixture loop scope.

## Scenario Smoke Checks

1. Onboarding path
- Validation: docs index links to workflow docs with current startup commands.
- Result: `PASS`

2. Backend API discovery path
- Validation: server guide includes current route groups (`/api/scraping`, `/api/workflows`, `/api/monitoring`).
- Result: `PASS`

3. Automation troubleshooting path
- Validation: troubleshooting guide includes workflow/scraping and python runtime sections.
- Result: `PASS`

## Closure

- Drift matrix backlog items are marked resolved.
- No unresolved docs-link or machine-local URI issues remain in scope.

## Issue #1 QA Remediation Evidence (2026-03-06)

Required command reruns (feature branch `issue-1` / PR #6 head):

1. `npm --prefix frontend run lint`
- Result: fail.
- Error class: pre-existing frontend lint violations unrelated to workflow import/export changes.
- Evidence: `artifacts/issue-1/frontend-lint.txt`.

2. `npm --prefix frontend run build`
- Result: pass.
- Evidence: `artifacts/issue-1/frontend-build.txt`.

3. `npm --prefix server run build`
- Result: pass.
- Evidence: `artifacts/issue-1/server-build.txt`.

Baseline-vs-feature separation:
- Baseline commit used: `02e0cc3` (parent of import/export implementation commit).
- Baseline reruns:
  - `npm --prefix .tmp_baseline_prev/frontend run lint` -> same lint failures as feature.
  - `npm --prefix .tmp_baseline_prev/frontend run build` -> pass.
  - `npm --prefix .tmp_baseline_prev/server run build` -> pass.
- Evidence:
  - `artifacts/issue-1/baseline-prev-frontend-lint.txt`
  - `artifacts/issue-1/baseline-prev-frontend-build.txt`
  - `artifacts/issue-1/baseline-prev-server-build.txt`

Regression/runtime protocol proof:
- Import contract scenarios (10 total: happy path, export envelope, collision rename, missing-list warning, invalid extension, unknown activity, missing edge endpoint, missing start node, file size cap, node cap):
  - `npx --yes tsx frontend/scripts/workflow-import-e2e.ts`
  - Evidence: `artifacts/issue-1/workflow-import-e2e.txt`
- Existing create/edit/duplicate/run behavior safety checks:
  - `npx --yes tsx frontend/scripts/workflow-regression-proof.ts`
  - Evidence: `artifacts/issue-1/workflow-regression-proof.txt`

Task #5 execution evidence and canary mapping:
- Local canary proof is attached under `artifacts/issue-1/`.
- Production runtime is not executed from this environment.
- Reproducible operator plan is attached in `artifacts/issue-1/task5-execution-plan.md`.
