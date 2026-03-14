# User Testing

Testing surface, resource cost classification per surface, and validation approach.

**What belongs here:** Validation surface details, testing tools, resource constraints, auth/setup info.

---

## Validation Surface

**Primary surface:** Web application
- Frontend: http://localhost:5173 (Vite dev server)
- Server API: http://localhost:3001
- WebSocket: ws://localhost:3001/ws

**Testing tool:** agent-browser (v0.17.1, confirmed working)

**Auth:** Clerk sign-in page at /sign-in (email + password)
- May need test credentials or Clerk dev mode bypass for smoke tests

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

## Limitations
- Datauploader not available in local dev (Docker-only service)
- VNC sessions not testable locally
- Automation process spawning requires Docker environment
- Auth flow requires valid Clerk credentials

## Setup Notes
- In this Windows Exec environment, `.factory/init.sh` is not directly runnable because `sh` is unavailable.
- Repository dependencies are already installed; use manifest validators and service commands directly instead of relying on the shell script.

## Flow Validator Guidance: Web application

- Reuse the shared local services only at `http://localhost:5173` and `http://localhost:3001`; do not start alternate ports.
- Stay within read-only smoke coverage unless the assigned assertions explicitly require mutation.
- Avoid triggering automation/VNC/datauploader flows; they are outside the safe local validation boundary for this milestone.
- If Clerk credentials are unavailable, validate unauthenticated surfaces such as `/` and `/sign-in`, plus API health checks and console/network stability.
- For Sentry-degradation checks, treat blank DSN environment overrides as part of test setup only; do not edit `.env` or `.env.local`.
