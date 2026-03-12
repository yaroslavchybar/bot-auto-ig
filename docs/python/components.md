# Python Components Reference

## Entry Points (runners/)

- `python/runners/launcher.py`: primary session launcher with action/proxy/timing controls.
- `python/runners/run_multiple_accounts.py`: multi-account runner.
- `python/runners/run_workflow.py`: workflow graph executor with event emission.

## Browser Layer (browser/)

- `python/browser/setup.py`: browser context creation, proxy handling, run_browser.
- `python/browser/fingerprint.py`: fingerprint generation.
- `python/browser/display.py`: display allocation.
- `python/browser/cookies.py`: cookie normalization and persistence.
- `python/browser/traffic.py`: traffic monitoring.

Use this layer for browser lifecycle, anti-detection strategy, and display allocation.

## Database Layer (database/)

- `python/database/client.py`: base client + fetch_usernames.
- `python/database/profiles.py`: profile CRUD.
- `python/database/accounts.py`: Instagram accounts.
- `python/database/settings.py`: settings.
- `python/database/messages.py`: message templates.
- `python/database/session.py`: shared session.

## Actions Layer (actions/)

- `python/actions/browsing/*`: feed scrolling, reels scrolling, comments.
- `python/actions/engagement/*`: follow, unfollow, approve follow requests.
- `python/actions/stories/*`: story watching.
- `python/actions/messaging/*`: DM sending.
- `python/actions/login/*`: login/auth.
- `python/actions/common.py`: shared action helpers (mouse, delays).

## Core Infrastructure (core/)

- `python/core/config.py`: Convex endpoint/env config.
- `python/core/models.py`: data models (ThreadsAccount, ScrollingConfig).
- `python/core/errors/`: error handling, exceptions, retry, http client.
- `python/core/logging.py`: logging configuration.
- `python/core/process/`: healthcheck, process manager, job object.
- `python/core/storage/`: atomic writes, state persistence, selector cache.
- `python/core/utils.py`: shared worker utilities.

## Verified Against

- Directory listings for `python/*`
- All 86 tests passing after restructure
