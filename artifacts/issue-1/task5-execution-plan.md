# Task #5 Execution Plan and Available Evidence

Date: 2026-03-06
PR: https://github.com/yaroslavchybar/bot-auto-ig/pull/6

## Available Local Evidence

- `frontend-lint.txt` (required command; fails with pre-existing lint findings)
- `frontend-build.txt` (required command; pass)
- `server-build.txt` (required command; pass)
- `workflow-import-e2e.txt` (import contract: 1 happy + 3 negative)
- `workflow-regression-proof.txt` (create/edit/duplicate/run wiring + runtime protocol safety)
- Baseline parity logs:
  - `baseline-prev-frontend-lint.txt`
  - `baseline-prev-frontend-build.txt`
  - `baseline-prev-server-build.txt`

## Production/Canary Execution Limitation

This environment does not run a deployed production stack for this repository, so no production run IDs are generated here.

## Exact Runnable Canary Plan

1. Start services:
   - `npm --prefix server run dev`
   - `npm --prefix frontend run dev`
2. Open Workflows tab and import a valid workflow JSON envelope.
3. Verify import creates a new workflow row (never overwrites existing one).
4. Verify duplicate/edit/run/stop actions still function on imported and pre-existing workflows.
5. Verify `Export JSON` is disabled while workflow status is `running`.
6. Capture screenshots/video plus server/frontend logs and attach to the QA artifact set.

Suggested artifacts for staging/prod gate:
- Workflow IDs used for canary run (pre-existing + imported)
- Import warning/error toasts for negative cases
- Run/stop API response logs for imported workflow
