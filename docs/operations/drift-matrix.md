# Docs Drift Matrix

This matrix captures baseline drift and closure status for all in-scope markdown docs.

Status legend:
- `accurate`: matched codebase at audit time
- `partial`: mostly correct with missing/obsolete details
- `stale`: materially diverged from codebase

## Matrix

| Doc | Owner | Risk | Initial | Key Drift Found | Action | Final |
|---|---|---|---|---|---|---|
| `AGENTS.md` | docs-core | onboarding | partial | Map missed updated domain coverage and verification pointers | Updated map links and rules | accurate |
| `frontend/README.md` | frontend | low | partial | Needed confirmation as pointer-only stub | Kept stub; validated target docs | accurate |
| `server/README.md` | server | low | partial | Needed confirmation as pointer-only stub | Kept stub; validated target docs | accurate |
| `convex/README.md` | convex | low | partial | Needed confirmation as pointer-only stub | Kept stub; validated target docs | accurate |
| `python/README.md` | python | low | partial | Needed confirmation as pointer-only stub | Kept stub; validated target docs | accurate |
| `python/browser_control/README.md` | python | low | stale | Anchor pointed to obsolete section id | Updated anchor to canonical section | accurate |
| `python/database_sync/README.md` | python | low | stale | Anchor pointed to obsolete section id | Updated anchor to canonical section | accurate |
| `python/getting_started/README.md` | python | low | partial | Needed dual pointers to current canonical sections | Confirmed and aligned links | accurate |
| `python/instagram_actions/README.md` | python | low | stale | Anchor pointed to obsolete section id | Updated anchor to canonical section | accurate |
| `python/instagram_actions/browsing/feed_scrolling/README.md` | python | low | stale | Anchor pointed to obsolete section id | Updated anchor to canonical section | accurate |
| `python/instagram_actions/browsing/reels_scrolling/README.md` | python | low | stale | Anchor pointed to obsolete section id | Updated anchor to canonical section | accurate |
| `python/instagram_actions/engagement/approve_follow_requests/README.md` | python | low | stale | Anchor/path alignment risk | Updated path + anchor | accurate |
| `python/instagram_actions/engagement/follow_users/README.md` | python | low | stale | Anchor/path alignment risk | Updated path + anchor | accurate |
| `python/instagram_actions/engagement/unfollow_users/README.md` | python | low | stale | Anchor/path alignment risk | Updated path + anchor | accurate |
| `python/internal_systems/README.md` | python | low | stale | Anchor pointed to obsolete section id | Updated anchor to canonical section | accurate |
| `scraper/README.md` | services | low | partial | Needed confirmation as pointer-only stub | Kept stub; validated target docs | accurate |
| `docs/README.md` | docs-core | onboarding | partial | Missing drift/verification index entries | Expanded index and maintenance policy | accurate |
| `docs/overview/knowledge-model.md` | docs-core | onboarding | partial | Needed explicit precedence and placement rules | Updated precedence and placement rules | accurate |
| `docs/overview/repository-map.md` | docs-core | onboarding | stale | Missing new frontend/server/convex domains | Rewrote from current structure | accurate |
| `docs/overview/developer-workflow.md` | docs-core | onboarding | partial | Missing root build/start flow and test style clarity | Updated command/test workflow | accurate |
| `docs/frontend/guide.md` | frontend | runtime | stale | Missing tabs (`accounts/scraping/workflows/vnc/monitoring`) and env integrations | Rewrote feature/runtime/env sections | accurate |
| `docs/server/guide.md` | server | API | stale | Missing route groups (`scraping/workflows/monitoring/displays`) and auth model nuance | Rewrote route/auth/rate-limit guide | accurate |
| `docs/convex/backend.md` | convex | API | stale | Mentioned modules not present; omitted `keywords/scrapingTasks/workflows` | Rewrote modules/tables/http/crons | accurate |
| `docs/python/automation.md` | python | runtime | partial | Needed explicit workflow runner boundary and test model | Rewrote runtime/test/orchestration sections | accurate |
| `docs/python/components.md` | python | runtime | partial | Needed current layer breakdown and stable section anchors | Rewrote component reference | accurate |
| `docs/services/datauploader.md` | services | API | partial | Endpoint list incomplete | Expanded endpoint inventory | accurate |
| `docs/services/scraper.md` | services | API | partial | Needed request/behavior detail verification | Updated API/behavior notes | accurate |
| `docs/operations/environment-and-security.md` | docs-core | runtime | stale | Env var list incomplete (`INTERNAL_API_KEY`, `SCRAPER_URL`, etc.) | Rebuilt env/security section | accurate |
| `docs/operations/docker-and-runtime.md` | docs-core | runtime | partial | Missing VNC and detailed service runtime notes | Updated ports/runtime notes | accurate |
| `docs/operations/troubleshooting.md` | docs-core | runtime | partial | Missing workflow/scraping/monitoring/display scenarios | Expanded troubleshooting scenarios | accurate |
| `docs/operations/content-parity.md` | docs-core | low | partial | Needed closure state and consolidation rules | Updated mapping + closure | accurate |

## Backlog Closure

- All `stale` and `partial` items from baseline are resolved in this refresh cycle.
- New drift findings should be appended here with owner/risk/action/final status.
