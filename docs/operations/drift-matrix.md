# Docs Drift Matrix

This matrix captures baseline drift and closure status for all in-scope markdown docs.

Status legend:
- `accurate`: matched codebase at audit time
- `partial`: mostly correct with missing or outdated details
- `stale`: materially diverged from codebase

## Matrix

| Doc | Owner | Risk | Initial | Key Drift Found | Action | Final |
|---|---|---|---|---|---|---|
| `AGENTS.md` | docs-core | onboarding | partial | Canonical docs list and quick repo map lagged the React Router frontend and Convex migrations surface | Updated canonical links, repo map, and hook naming guidance | accurate |
| `frontend/README.md` | frontend | low | accurate | Pointer-only stub still matched canonical target | No change required | accurate |
| `server/README.md` | server | low | accurate | Pointer-only stub still matched canonical target | No change required | accurate |
| `convex/README.md` | convex | low | accurate | Pointer-only stub still matched canonical target | No change required | accurate |
| `python/README.md` | python | low | accurate | Pointer-only stub still matched canonical targets | No change required | accurate |
| `python/browser_control/README.md` | python | low | accurate | Pointer anchor still matched canonical section | No change required | accurate |
| `python/database_sync/README.md` | python | low | accurate | Pointer anchor still matched canonical section | No change required | accurate |
| `python/getting_started/README.md` | python | low | stale | Second anchor pointed to `#getting-started-components`, but the canonical section heading had drifted | Realigned canonical heading and pointer target | accurate |
| `python/instagram_actions/README.md` | python | low | accurate | Pointer anchor still matched canonical section | No change required | accurate |
| `python/instagram_actions/browsing/feed_scrolling/README.md` | python | low | accurate | Pointer anchor still matched canonical section | No change required | accurate |
| `python/instagram_actions/browsing/reels_scrolling/README.md` | python | low | accurate | Pointer anchor still matched canonical section | No change required | accurate |
| `python/instagram_actions/engagement/approve_follow_requests/README.md` | python | low | accurate | Pointer anchor still matched canonical section | No change required | accurate |
| `python/instagram_actions/engagement/follow_users/README.md` | python | low | accurate | Pointer anchor still matched canonical section | No change required | accurate |
| `python/instagram_actions/engagement/unfollow_users/README.md` | python | low | accurate | Pointer anchor still matched canonical section | No change required | accurate |
| `python/internal_systems/README.md` | python | low | accurate | Pointer anchor still matched canonical section | No change required | accurate |
| `scraper/README.md` | services | low | accurate | Pointer-only stub still matched canonical target | No change required | accurate |
| `docs/README.md` | docs-core | onboarding | partial | Canonical docs index omitted the frontend component audit page | Added missing canonical entry | accurate |
| `docs/overview/knowledge-model.md` | docs-core | onboarding | accurate | Precedence and placement rules still matched repo expectations | No change required | accurate |
| `docs/overview/repository-map.md` | docs-core | onboarding | stale | Described obsolete frontend/server shapes and omitted `convex/migrations.ts` | Rebuilt map from current entrypoints and directory layout | accurate |
| `docs/overview/developer-workflow.md` | docs-core | onboarding | partial | Hook naming guidance excluded the repo's `useX.tsx` files | Expanded naming guidance | accurate |
| `docs/frontend/guide.md` | frontend | runtime | stale | Referenced removed `App.tsx` / `ProtectedApp.tsx` entrypoints and omitted current React Router structure | Rewrote app-shape, route, and verification sections | accurate |
| `docs/frontend/component-audit.md` | frontend | low | accurate | Audit page still matched the current frontend organization | No change required | accurate |
| `docs/server/guide.md` | server | API | partial | Needed current startup behavior, CORS/auth detail, and scraping-router split | Refreshed startup, route, and verification sections | accurate |
| `docs/convex/backend.md` | convex | API | partial | Omitted `convex.config.ts`, `migrations.ts`, and generated artifact boundaries | Expanded module inventory and migration notes | accurate |
| `docs/python/automation.md` | python | runtime | partial | Needed current environment/config detail and verified entrypoint list | Refreshed entrypoint, environment, and verification sections | accurate |
| `docs/python/components.md` | python | runtime | partial | Needed canonical heading alignment for README anchors and a more concrete verification list | Renamed heading and refreshed references | accurate |
| `docs/services/datauploader.md` | services | API | partial | Endpoint notes missed request/query details and processing response shape | Expanded request and runtime notes | accurate |
| `docs/services/scraper.md` | services | API | partial | Needed request constraints and session-verification nuance | Refreshed API and behavior notes | accurate |
| `docs/operations/environment-and-security.md` | docs-core | runtime | partial | Verified-against section referenced removed frontend entrypoints and Python env vars were incomplete | Corrected environment references | accurate |
| `docs/operations/docker-and-runtime.md` | docs-core | runtime | accurate | Runtime and port notes still matched current containers | No change required | accurate |
| `docs/operations/troubleshooting.md` | docs-core | runtime | partial | Docs-integrity grep matched the troubleshooting and verification pages because they documented the literal command string, and verified-against references lagged current frontend/server files | Updated the integrity-check command and verification references | accurate |
| `docs/operations/content-parity.md` | docs-core | low | partial | Closure state did not mention docs-index alignment work | Updated closure state | accurate |
| `docs/operations/verification-log.md` | docs-core | runtime | stale | Claimed March 5, 2026 full closure against a newer codebase state | Replaced with fresh verification results from this refresh | accurate |

## Backlog Closure

- All `stale` and `partial` items found in the March 9, 2026 canonical-docs refresh are resolved in this cycle.
- New drift findings should be appended here with owner, risk, action, and final status.
