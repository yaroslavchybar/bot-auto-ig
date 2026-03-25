# User Testing

Testing surface, resource cost classification per surface, and validation approach.

**What belongs here:** Validation surface details, testing tools, resource constraints, auth/setup info.

---

## Validation Surface

**Primary surface:** Web application
- Frontend: http://localhost:5173 (Vite dev server)
- Server API: http://localhost:3001
- WebSocket: ws://localhost:3001/ws

**Additional surface:** Python automation CLI
- Primary command: `python -m pytest python/tests -q`
- Supporting commands: `rg` checks for `compat`, `query_selector`, and import-boundary violations; Python line/function scans
- No app services are required for this surface; validation runs directly against the checked-out source tree

**Testing tool:** agent-browser (v0.17.1, confirmed working)

**Auth:** Clerk sign-in page at /sign-in (email + password)
- May need test credentials or Clerk dev mode bypass for smoke tests
- Shared state currently does not include Clerk smoke-test credentials or a documented auth-bypass path for protected routes. Redirect-only checks validate the auth guard, but they do not prove that post-auth pages like `/accounts` or `/workflows` actually rendered.
- Clerk's documented test-email flow can unblock local validation on development instances: any email address with a `+clerk_test` subaddress can be verified with code `424242`. Use a unique alias per validator run to avoid collisions.

**Key pages to validate:**
- /sign-in (auth page)
- /accounts (post-auth)
- /profiles (post-auth)
- /lists (post-auth)
- /workflows (post-auth)
- /logs (post-auth)
- /monitoring (post-auth)
- /vnc (post-auth)
- /scraped-data (post-auth)

## Validation Concurrency

**Machine:** Windows 10, 16GB RAM (15.4GB usable), 12 cores, ~2.5GB free at baseline

**Dev server pair cost:** ~650MB (frontend Vite + server tsx)
**Agent-browser session cost:** ~100-200MB each
**Available headroom after dev servers:** ~1.8GB

**Max concurrent validators: 2** (conservative, leaves buffer for system stability)

**Rationale:** 2 browsers × 200MB = 400MB + 650MB dev servers = 1050MB total. Leaves ~1.4GB for system. Safe margin given heavy baseline load (Chrome 3GB, Docker 2.2GB, VS Code 900MB).

**Python CLI max concurrent validators: 2**

**Rationale:** Current available physical memory is ~5.5GB. One pytest run plus one read-only static-analysis validator is safe in parallel, but avoid concurrent pytest processes because they share caches and add unnecessary runtime cost.

## Limitations
- Datauploader not available in local dev (Docker-only service)
- VNC sessions not testable locally
- Automation process spawning requires Docker environment
- Auth flow requires valid Clerk credentials

## Setup Notes
- In this Windows Exec environment, `.factory/init.sh` is not directly runnable because `sh` is unavailable.
- Repository dependencies are already installed; use manifest validators and service commands directly instead of relying on the shell script.
- If `http://localhost:3001/api/health` and `http://localhost:5173` already return `200`, you can reuse the running local services instead of restarting them.

## Flow Validator Guidance: Web application

- Reuse the shared local services only at `http://localhost:5173` and `http://localhost:3001`; do not start alternate ports.
- Stay within read-only smoke coverage unless the assigned assertions explicitly require mutation.
- Avoid triggering automation/VNC/datauploader flows; they are outside the safe local validation boundary for this milestone.
- If Clerk credentials are unavailable, first try a disposable Clerk test email using the documented `+clerk_test` alias flow and verification code `424242`; if that still fails, fall back to unauthenticated surfaces such as `/` and `/sign-in`, plus API health checks and console/network stability.
- For Sentry-degradation checks, treat blank DSN environment overrides as part of test setup only; do not edit `.env` or `.env.local`.

## Flow Validator Guidance: Server reliability CLI

- Use repo-local scripts or one-off CLI harnesses only; do not modify application source files while validating.
- If a validation step needs to stop or restart the server/frontend, serialize that flow with any browser-based validation because both share ports `3001` and `5173`.
- Keep all temporary evidence under the assigned mission evidence directory, and clean up any helper processes you start by explicit PID.
- Prefer exercising exported modules (`automation/shutdown`, `automation/state`, `shared/ProcessService`, `shared/mutex`, `shared/convexClient`) and real manifest services over ad-hoc mocks of the application's own code.

## Flow Validator Guidance: Python automation CLI

- Stay inside the repo working tree and validate the Python milestone through real CLI entry points and source-tree inspections only.
- Use a single pytest process at a time. Read-only `rg`/file-inspection commands may run in parallel with pytest.
- Do not edit application code while validating. Only write the assigned flow report and evidence files.
- Prefer commands that mirror the mission contract exactly, especially `python -m pytest python/tests -q`.
- Treat structural assertions (size limits, import boundaries, removed compat proxies, locator API usage) as CLI-observable contract checks using `rg`, Python scripts, and file inspection.
