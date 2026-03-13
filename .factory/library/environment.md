# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Required Environment Variables

- CONVEX_URL, VITE_CONVEX_URL, CONVEX_URL_DEV — Convex cloud URLs
- VITE_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY — Clerk auth
- INTERNAL_API_KEY — Server-to-server auth for cron→workflow calls
- SENTRY_DSN_FRONTEND, VITE_SENTRY_DSN — Frontend Sentry
- SENTRY_DSN_SERVER — Server Sentry
- SENTRY_DSN_PYTHON — Python Sentry

## Platform Notes

- Windows 10, 16GB RAM, 12 cores
- Docker Desktop available but resource-constrained (~2.5GB free RAM)
- Node.js, Python 3.12, npm available globally
- Process kill uses `taskkill` on Windows (not SIGTERM)
