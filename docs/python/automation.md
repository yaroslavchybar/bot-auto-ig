# Python Automation Guide

## Purpose

`python/` is the browser automation runtime executed by server automation and workflow routes.

## Entry Points

- `python/runners/launcher.py` (manual/session automation launcher)
- `python/runners/run_multiple_accounts.py` (multi-account execution helper)
- `python/runners/run_workflow.py` (workflow executor)

## Runtime Architecture

- `actions/`: feed/reels/engagement/stories/messaging/login actions.
- `browser/`: browser setup, fingerprints, display/session helpers.
- `database/`: Convex-facing clients.
- `core/`: config, error handling, logging, process management, data models, storage.

## Workflow Runtime Settings

- Workflow execution reads workflow-wide settings from the `start_browser` node, including headless mode, parallel profile count, profile reopen cooldown, and messaging cooldown.
- Workflow profile selection uses the cooldown-aware Convex profiles availability route when profile reopen cooldown is enabled.
- Workflow DM targeting uses `instagramAccounts.lastMessagedAt` plus node/runtime cooldown settings to skip recently messaged accounts.
- Workflow scrape nodes execute in the logged-in browser context, persist retry/resume state in workflow `nodeStates`, and publish downloadable workflow artifacts.
- Workflow scrape nodes honor per-profile `dailyScrapingLimit` / `dailyScrapingUsed` counters, skip exhausted auth profiles, increment usage after each successful scrape chunk, and queue multiple auth profiles sequentially until the scrape work completes.
- Activity nodes now drive behavior-facing action timing directly in the workflow runner:
  - feed scrolling: story watch toggle, story view timing, skip behavior, post view timing
  - reels scrolling: watch timing, advance timing, reel follow chance
  - stories: per-story view timing
  - follow / unfollow / approve / messaging: per-target pacing, with inverted delay ranges normalized before waits or typing/navigation delays are applied

## Server Orchestration Boundaries

- Server starts Python for manual automation/profile sessions.
- Workflows API starts `run_workflow.py` with JSON payload over stdin.
- Multi-account helper flows remain in `python/runners/` and are not mounted as direct server API endpoints.
- Runtime emits structured `__EVENT__`-prefixed JSON lines for WS propagation.

## Reliability Model

- Pre-flight checks (internet/proxy/disk in launcher flow).
- Retry loop and decision-based exception handling in launcher/runtime internals.
- Graceful signal handling and display/session cleanup.

## Testing Model

- Tests are primarily unittest-style under `python/tests/`.
- Team command remains pytest execution:

```bash
python -m pytest python/tests -q
```

## Environment Notes

- Convex endpoint/key settings come from `python/core/config.py`, which loads `.env` when `python-dotenv` is available and reuses `INTERNAL_API_KEY` for protected HTTP actions.
- Feed debug behavior reads `FEED_DEBUG_MOUSE` in feed scrolling modules.
- Browser bootstrap seeds the cursor to a randomized viewport-safe start position before the first navigation so sessions do not visibly begin from a fixed viewport edge.
- Shared browser bootstrap preloads normalized profile cookies from Convex before the first Instagram navigation and writes the latest cookies back on successful session updates and clean shutdown.

## Verified Against

- Directory listings for `python/*`
- All 86 tests passing after restructure
- `python/tests`
