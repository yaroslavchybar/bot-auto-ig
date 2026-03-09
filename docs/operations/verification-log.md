# Verification Log

Verification date: 2026-03-09

## Integrity Checks

1. Literal `file:///` grep from the previous process
- Command: `git grep -n "file:///" -- "*.md"`
- Result: advisory.
- Note: this now matches the docs pages that document the command itself (`docs/operations/troubleshooting.md` and this file), so it is not a reliable pass/fail signal on its own.

2. File URI grep excluding the docs pages that document the command
- Command: `git grep -n "file:///" -- "*.md" ":!docs/operations/troubleshooting.md" ":!docs/operations/verification-log.md"`
- Result: pass (`NO_FILE_URI_LINKS_OUTSIDE_CHECK_DOCS`)

3. Relative markdown link and anchor check (tracked markdown)
- Command: local Node-based validator over `git ls-files "*.md"`
- Result: pass (`LINK_CHECK_OK_TRACKED_MD`)

## Command Spot-Checks

1. Root path command
- Command: `npm run build`
- Result: pass (`npm --prefix server run build` completed)

2. Server path command
- Command: `npm --prefix server run build`
- Result: pass (`tsc` completed)

3. Frontend path command
- Command: `npm --prefix frontend run build`
- Result: pass (`react-router build` completed)
- Note: Vite emitted sourcemap-resolution warnings for `src/components/ui/tooltip.tsx` and `src/components/ui/avatar.tsx`, but the client and server builds completed successfully.

4. Python path command
- Command: `python -m pytest python/tests -q --collect-only`
- Result: fail (`No module named pytest`)
- Note: Python test collection could not be executed in this environment because `pytest` is not installed.

## Scenario Smoke Checks

1. Docs index path
- Validation: `docs/README.md` includes the frontend component audit in the canonical index.
- Result: `PASS`

2. Frontend architecture path
- Validation: frontend guide and repository map reference the current React Router entrypoints (`root.tsx`, `routes.ts`, `entry.client.tsx`, `entry.server.tsx`).
- Result: `PASS`

3. Pointer-stub path
- Validation: `python/getting_started/README.md` now resolves to the current heading in `docs/python/components.md`.
- Result: `PASS`

## Closure

- Canonical docs now reflect the repository state audited on March 9, 2026.
- The previous self-matching `file:///` check has been replaced in docs guidance with an exclusion-based variant that produces a meaningful result.
- Python test collection remains unverified in this environment until `pytest` is installed.
