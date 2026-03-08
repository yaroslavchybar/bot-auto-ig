# Python Automation Guide

## Purpose

`python/` is the browser automation runtime executed by server automation and workflow routes.

## Entry Points

- `python/getting_started/launcher.py` (manual/session automation launcher)
- `python/getting_started/run_multiple_accounts.py`
- `python/getting_started/run_workflow.py` (workflow executor)

## Runtime Architecture

- `instagram_actions/`: feed/reels/engagement/stories/messaging/login actions.
- `browser_control/`: browser setup, fingerprints, display/session helpers.
- `database_sync/`: Convex-facing clients and config.
- `internal_systems/`: error handling, logging, process management, data models, storage.

## Server Orchestration Boundaries

- Server starts Python for manual automation/profile sessions.
- Workflows API starts `run_workflow.py` with JSON payload over stdin.
- Runtime emits structured `__EVENT__...__EVENT__` messages for WS propagation.

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

- Convex endpoint/key settings come from `python/database_sync/config.py`.
- Feed debug behavior reads `FEED_DEBUG_MOUSE` in feed scrolling modules.
- Browser bootstrap seeds the cursor to a randomized viewport-safe start position before the first navigation so sessions do not visibly begin from a fixed viewport edge.
- Shared browser bootstrap preloads normalized profile cookies from Convex before the first Instagram navigation and writes the latest cookies back on successful session updates and clean shutdown.

## Verified Against

- `python/getting_started/launcher.py`
- `python/getting_started/run_workflow.py`
- `python/database_sync/config.py`
- `python/instagram_actions/browsing/feed_scrolling/likes.py`
- `python/instagram_actions/browsing/feed_scrolling/scroll.py`
- `python/internal_systems/*`
- `python/tests/*`
