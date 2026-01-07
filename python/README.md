# Anti (Python)

Automation utilities built around Playwright + Camoufox to run Instagram-style browsing sessions (feed scrolling, reels scrolling, stories watching, follow/unfollow flows, messaging, and follow-request approval) with basic resilience primitives (health checks, retry/backoff, traffic monitoring, structured logging) and optional Convex-backed data sources.

This folder is designed to run either:

- Locally (Windows-friendly; uses Windows Job Objects for cleanup).
- In Docker (see [Dockerfile](file:///c:/Users/yaros/Downloads/anti/python/Dockerfile)).

## Project Layout

- `launcher.py`: main single-session entrypoint (CLI).
- `automation/`: browser automation flows.
  - `browser.py`: creates Camoufox/Playwright contexts, proxy parsing, circuit breaker, snapshots.
  - `scrolling/`: feed + reels scrolling logic.
  - `stories/`: story tray + story watching.
  - `Follow/`: follow-by-username flow.
  - `unfollow/`, `approvefollow/`, `messaging/`: additional flows.
- `core/`: shared infrastructure.
  - `domain/models.py`: config/data models.
  - `observability/logging_config.py`: JSON file logs + console logs.
  - `resilience/`: retry/backoff, traffic monitor, error classification.
  - `runtime/`: health checks, Windows Job Object, process cleanup.
- `convex/`: HTTP clients for Convex endpoints (profiles, accounts, settings, templates).
- `data/`: runtime data.
  - `profiles/` (created on demand): persistent browser profiles.
  - `selector_cache.json`: cached selector strategies.
- `tests/`: unit tests (unittest).

## Requirements

- Python 3.10+ recommended.
- Playwright (Firefox) installed.
- Camoufox runtime (Camoufox wraps Firefox with extra features).

Python deps are listed in [requirements.txt](file:///c:/Users/yaros/Downloads/anti/python/requirements.txt).

## Install (Local)

From the repository root:

```bash
python -m venv .venv
./.venv/Scripts/activate
pip install -r python/requirements.txt
python -m playwright install firefox
```

On Linux you may also need Playwright OS deps:

```bash
python -m playwright install-deps firefox
```

## Quick Start (Single Session)

You can run from the `python/` folder:

```bash
cd python
python launcher.py --name my_profile --proxy None --action manual
```

Or from the repository root:

```bash
python python/launcher.py --name my_profile --proxy None --action manual
```

### Common Arguments

`launcher.py` accepts (non-exhaustive):

- `--name` (required): profile name. Used as the directory name under `python/data/profiles/`.
- `--proxy`: proxy string or `None`.
- `--action`: `manual`, `scroll`, `reels`, `mixed`.
- `--duration`: minutes for single-action modes.
- `--feed-duration`, `--reels-duration`: minutes in `mixed` mode.
- `--match-likes`, `--match-comments`, `--match-follows`: chances (0–100) for interactions.
- `--reels-match-likes`, `--reels-match-follows`: per-reels interaction chances.
- `--carousel-watch-chance`, `--carousel-max-slides`: carousel behavior.
- `--watch-stories` (`1`/`0`), `--stories-max`: story behavior.
- `--user-agent`: override UA.
- `--os`: emulated OS (`windows`, `macos`, `linux`).

The launcher performs pre-flight checks (internet, disk space, and optional proxy check) via [healthcheck.py](file:///c:/Users/yaros/Downloads/anti/python/core/runtime/healthcheck.py).

## Proxy Format

Proxy parsing is implemented in [parse_proxy_string](file:///c:/Users/yaros/Downloads/anti/python/automation/browser.py#L161-L231). Supported inputs include:

- `scheme://user:pass@host:port`
- `scheme://host:port:user:pass` (non-standard)
- `host:port:user:pass` (assumes `http`)
- `host:port`

The launcher uses a requests-style proxy dict for its proxy health check. If you pass `--proxy None`, it skips that check.

## Profiles and State

- Profile directories are created under `python/data/profiles/<profile_name>/` by [ensure_profile_path](file:///c:/Users/yaros/Downloads/anti/python/automation/browser.py#L233-L249).
- A legacy location (`cli/profiles/<profile_name>`) is migrated if present.

## Logging and Debugging

- Logging is configured in [logging_config.py](file:///c:/Users/yaros/Downloads/anti/python/core/observability/logging_config.py).
- Default log file path is `data/logs/bot.log` at the repository root (created if missing).
- Logs are JSON-formatted in the file and also emitted to console.
- Browser-side failures can trigger debug snapshots via [snapshot_debugger.py](file:///c:/Users/yaros/Downloads/anti/python/core/observability/snapshot_debugger.py) (used from `automation/browser.py`).

## Resilience Model

- Exception classification is implemented in [classify_exception](file:///c:/Users/yaros/Downloads/anti/python/core/resilience/error_handler.py#L21-L75) and drives “retry / restart / backoff / abort” behavior.
- Network/proxy failures are treated as retryable; login-required and banned-account errors abort.
- A proxy circuit breaker and health/taint tracking is implemented in [automation/browser.py](file:///c:/Users/yaros/Downloads/anti/python/automation/browser.py).

## Convex Integration (Optional)

The clients in `python/convex/` use:

- `CONVEX_URL`: Convex deployment URL.
- `CONVEX_API_KEY`: bearer token used for HTTP actions.

These values are read from environment variables in [convex/config.py](file:///c:/Users/yaros/Downloads/anti/python/convex/config.py) and will also be loaded from a repo-root `.env` file if `python-dotenv` is installed.

Typical `.env` at repository root:

```ini
CONVEX_URL=https://<your-deployment>.convex.site
CONVEX_API_KEY=<server-side-key>
```

If you don’t set these variables, Convex-backed features will raise a “Convex config missing” error when those clients are instantiated.

## Docker

Build from the `python/` folder:

```bash
cd python
docker build -t anti-python .
```

Run a session (example):

```bash
docker run --rm -e PYTHONUNBUFFERED=1 anti-python \
  python launcher.py --name my_profile --proxy None --action scroll --duration 5
```

Notes:

- The image installs Playwright Firefox and OS dependencies.
- In containers, running headful browsers can require extra configuration (Xvfb, display forwarding).

## Running Tests

Tests use the standard library `unittest` framework.

From repository root:

```bash
python -m unittest discover -s python/tests -p "test_*.py" -v
```

From `python/`:

```bash
python -m unittest discover -s tests -p "test_*.py" -v
```

## Related Entry Points

- `python/scripts/instagram_automation.py` runs multi-profile automation with Convex clients and `ThreadPoolExecutor`.
- `supervisor.py` exists in this folder but currently references modules that are not present under `python/core/` in this repository state.

## Safety and Compliance

Browser automation against third-party services can violate terms of service and trigger account restrictions. Use responsibly, keep interaction rates conservative, and prefer dedicated test accounts.

