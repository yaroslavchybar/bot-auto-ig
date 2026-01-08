# Anti Python Automation Module

> **AI Agent Context**: This module provides Instagram browser automation using Playwright + Camoufox. It acts as the "execution muscle" for the Anti system, controlled via CLI or programmatic invocation. The Node.js server in `../server/` orchestrates this module.

## Quick Reference

| Aspect | Details |
|--------|---------|
| **Python Version** | 3.10+ required |
| **Browser Engine** | Camoufox (Firefox fork with fingerprint spoofing) |
| **Entry Point** | `getting_started/launcher.py` (single session) or `getting_started/run_multiple_accounts.py` (multi-profile) |
| **Profile Storage** | `data/profiles/<profile_name>/` |
| **Logs** | JSON format, `data/logs/bot.log` and console |
| **Dependencies** | `requirements.txt` (camoufox[geoip], playwright, pyotp, python-dotenv, requests, psutil) |

---

## Architecture Overview

```
python/
├── getting_started/               # ✨ Entry points - START HERE
│   ├── launcher.py                # CLI for single-session automation
│   └── run_multiple_accounts.py   # Multi-profile automation runner
│
├── instagram_actions/             # 📱 All Instagram automations
│   ├── browsing/                  # Feed & Reels scrolling
│   │   ├── feed_scrolling/        # Feed scroll, likes, follows
│   │   ├── reels_scrolling/       # Reels scroll and interactions
│   │   └── utils.py               # Shared scrolling utilities
│   ├── engagement/                # User engagement actions
│   │   ├── follow_users/          # Follow-by-username workflows
│   │   ├── unfollow_users/        # Unfollow automation
│   │   └── approve_follow_requests/  # Follow request approval
│   ├── stories/                   # Story watching automation
│   ├── messaging/                 # Direct message automation
│   ├── login/                     # Login flow handlers
│   └── actions.py                 # Shared action utilities
│
├── browser_control/               # 🌐 Browser & anti-detection
│   ├── browser_setup.py           # Browser context, proxy, circuit breaker
│   └── fingerprint_generator.py   # Browser fingerprint generation
│
├── database_sync/                 # 🔄 Convex backend communication
│   ├── config.py                  # CONVEX_URL, CONVEX_API_KEY from env
│   ├── profiles_client.py         # Browser profile management
│   ├── accounts_client.py         # Instagram account data
│   ├── settings_client.py         # Automation settings
│   └── messages_client.py         # Message template retrieval
│
├── internal_systems/              # ⚙️ Core infrastructure (don't modify)
│   ├── error_handling/            # Retry logic, circuit breakers
│   ├── logging/                   # Logging, debugging, snapshots
│   ├── storage/                   # Local state persistence
│   ├── process_management/        # Health checks, job objects
│   ├── data_models/               # Data classes
│   └── shared_utilities/          # Selectors, worker utilities
│
├── data/                          # Runtime data (gitignored)
│   ├── profiles/                  # Persistent browser profiles
│   └── logs/                      # Application logs
│
└── tests/                         # Unit tests (unittest framework)
```

---

## Key Components

### `getting_started/launcher.py` - Single Session Entry Point

**Purpose**: Run one browser session with specified action and configuration.

**Invocation**:
```bash
# From python/ directory
python getting_started/launcher.py --name <profile_name> --proxy <proxy_string|None> --action <action>

# From repository root
python python/getting_started/launcher.py --name my_profile --proxy None --action manual
```

**CLI Arguments**:

| Argument | Type | Default | Description |
|----------|------|---------|-------------|
| `--name` | str | **required** | Profile name (maps to `data/profiles/<name>/`) |
| `--proxy` | str | `"None"` | Proxy URL or `"None"` to skip |
| `--action` | str | `"manual"` | One of: `manual`, `scroll`, `reels`, `mixed` |
| `--duration` | int | 5 | Session duration in minutes |
| `--feed-duration` | int | 0 | Feed duration in `mixed` mode |
| `--reels-duration` | int | 0 | Reels duration in `mixed` mode |
| `--match-likes` | int | 0 | Like chance 0-100% for feed |
| `--match-comments` | int | 0 | Comment chance 0-100% for feed |
| `--match-follows` | int | 0 | Follow chance 0-100% for feed |
| `--reels-match-likes` | int | None | Like chance for reels (inherits from `--match-likes`) |
| `--reels-match-follows` | int | None | Follow chance for reels (inherits from `--match-follows`) |
| `--carousel-watch-chance` | int | 0 | Chance to advance carousel slides 0-100% |
| `--carousel-max-slides` | int | 3 | Max slides to view in carousels |
| `--watch-stories` | int | 1 | Watch stories at session start (1/0) |
| `--stories-max` | int | 3 | Maximum stories to watch |
| `--user-agent` | str | None | Override browser user agent |
| `--os` | str | None | Emulated OS: `windows`, `macos`, `linux` |
| `--fingerprint-os` | str | None | Fingerprint OS flavor |

**Execution Flow**:
1. Parse arguments
2. Run health checks (internet, disk, proxy)
3. Initialize Windows Job Object (for child process cleanup)
4. Retry loop with exponential backoff
5. Call `run_browser()` from `browser_control/browser_setup.py`

---

### `browser_control/browser_setup.py` - Browser Context Management

**Purpose**: Create and manage Camoufox browser contexts with anti-detection features.

**Key Functions**:

| Function | Signature | Purpose |
|----------|-----------|---------|
| `run_browser` | `(profile_name, proxy_string, action, duration, ...)` | Main orchestrator - creates context, dispatches to action handlers |
| `create_browser_context` | `(profile_name, proxy_string, user_agent, ...)` | Initializes Camoufox with fingerprint spoofing |
| `parse_proxy_string` | `(proxy_string) -> dict` | Parses various proxy formats to Playwright format |
| `ensure_profile_path` | `(profile_name, base_dir) -> str` | Creates/returns profile directory path |
| `safe_goto` | `(page, url, timeout)` | Navigation with timeout handling |

**Proxy Format Support**:
```
scheme://user:pass@host:port      # Standard
scheme://host:port:user:pass      # Non-standard colon-separated
host:port:user:pass               # No scheme (assumes HTTP)
host:port                         # No auth
```

**Circuit Breaker**:
The `ProxyCircuitBreaker` class tracks consecutive proxy failures and pauses automation when threshold is exceeded.

```python
proxy_circuit = ProxyCircuitBreaker()
# After 3 consecutive failures, circuit opens for 60 seconds
```

---

### `core/resilience/error_handler.py` - Error Classification

**Purpose**: Route exceptions to appropriate recovery strategies.

**Error Decisions**:

| Decision | Trigger Exceptions | Behavior |
|----------|-------------------|----------|
| `ABORT` | `AccountBannedException`, `LoginRequiredException`, `FatalError` | Stop immediately |
| `RESTART_BROWSER` | `StaleStateError`, Playwright "Target closed" | Close and reopen browser |
| `BACKOFF_AND_SLOW` | `RateLimitException` | Wait 60s + jitter, continue |
| `RETRY` | `TransientError`, `NetworkError`, `ProxyError`, `TimeoutError` | Retry with exponential backoff |

**Usage**:
```python
from python.core.resilience.error_handler import classify_exception, ErrorDecision

decision = classify_exception(caught_exception)
if decision == ErrorDecision.RETRY:
    # implement retry logic
```

---

### `core/domain/models.py` - Data Models

**`ScrollingConfig`** - Complete automation configuration:
```python
@dataclass
class ScrollingConfig:
    # Profile settings
    use_private_profiles: bool
    use_threads_profiles: bool
    
    # Interaction chances (0-100%)
    like_chance: int
    comment_chance: int
    follow_chance: int
    reels_like_chance: int
    reels_follow_chance: int
    
    # Timing (minutes)
    feed_min_time_minutes: int
    feed_max_time_minutes: int
    reels_min_time_minutes: int
    reels_max_time_minutes: int
    
    # Feature toggles
    enable_feed: bool = True
    enable_reels: bool = False
    enable_follow: bool = False
    enable_unfollow: bool = False
    enable_approve: bool = False
    enable_message: bool = False
    
    # Advanced settings
    carousel_watch_chance: int = 0
    carousel_max_slides: int = 3
    watch_stories: bool = True
    stories_max: int = 3
    headless: bool = False
```

---

### Convex Integration

**Purpose**: Fetch configuration and account data from Convex backend.

**Environment Variables** (set in `.env` at repo root):
```ini
CONVEX_URL=https://<deployment>.convex.site
CONVEX_API_KEY=<server-side-key>
```

**Clients**:

| Client | File | Purpose |
|--------|------|---------|
| `ProfilesClient` | `convex/profiles_client.py` | Manage browser profiles |
| `InstagramAccountsClient` | `convex/instagram_accounts_client.py` | Account credentials, cooldowns |
| `InstagramSettingsClient` | `convex/instagram_settings_client.py` | Global automation settings |
| `MessageTemplatesClient` | `convex/message_templates_client.py` | DM templates |

---

## Installation

### Local (Windows/Linux/macOS)

```bash
# Create virtual environment
python -m venv .venv

# Activate (Windows PowerShell)
.\.venv\Scripts\Activate.ps1

# Activate (Linux/macOS)
source .venv/bin/activate

# Install dependencies
pip install -r python/requirements.txt

# Install Playwright Firefox
python -m playwright install firefox

# Linux only: Install system dependencies
python -m playwright install-deps firefox
```

### Docker

```bash
cd python
docker build -t anti-python .

# Run session
docker run --rm -e PYTHONUNBUFFERED=1 anti-python \
  python launcher.py --name my_profile --proxy None --action scroll --duration 5
```

> **Note**: Headful browsers in Docker require Xvfb or display forwarding.

---

## Usage Examples

### Manual Session (Interactive)
```bash
python launcher.py --name test_profile --proxy None --action manual
```

### Automated Feed Scrolling
```bash
python launcher.py --name prod_account \
  --proxy "http://user:pass@proxy.example.com:8080" \
  --action scroll \
  --duration 10 \
  --match-likes 30 \
  --match-follows 5 \
  --watch-stories 1 \
  --stories-max 5
```

### Mixed Mode (Feed + Reels)
```bash
python launcher.py --name mixed_session \
  --proxy None \
  --action mixed \
  --feed-duration 5 \
  --reels-duration 5 \
  --match-likes 20 \
  --reels-match-likes 40
```

### Multi-Profile Automation (Script)
```bash
# Requires Convex environment variables
python scripts/instagram_automation.py
```

---

## Logging & Debugging

**Log Configuration**: `core/observability/logging_config.py`

**Log Locations**:
- File: `data/logs/bot.log` (JSON formatted)
- Console: Human-readable with colors

**Debug Snapshots**: On browser errors, screenshots and HTML are saved via `core/observability/snapshot_debugger.py` to `data/debug/`.

**Log Levels**:
```python
import logging
logger = logging.getLogger(__name__)
logger.debug("Detailed trace")
logger.info("Normal operation")
logger.warning("Potential issue")
logger.error("Error occurred", extra={"decision": "RETRY", "exception": str(e)})
```

---

## Testing

```bash
# From repository root
python -m unittest discover -s python/tests -p "test_*.py" -v

# From python/ directory
python -m unittest discover -s tests -p "test_*.py" -v
```

---

## Error Handling & Resilience

### Exception Hierarchy

```
Exception
├── FatalError                  # → ABORT (unrecoverable)
│   ├── AccountBannedException
│   └── LoginRequiredException
├── RecoverableError            # → Depends on subclass
│   ├── TransientError          # → RETRY
│   ├── NetworkError            # → RETRY
│   ├── ProxyError              # → RETRY
│   ├── StaleStateError         # → RESTART_BROWSER
│   └── RateLimitException      # → BACKOFF_AND_SLOW
├── ElementNotFoundError        # → RETRY
└── SelectorTimeoutError        # → RETRY
```

### Retry Behavior

The launcher implements a retry loop with:
- Max 3 retries for transient errors
- Exponential backoff: `base * (2 ** attempt) + jitter`
- 60-second pause for rate limits
- Immediate abort for fatal errors

---

## Process Management

### Windows Job Objects
On Windows, child processes (browsers) are attached to a Job Object ensuring they terminate when the parent process exits.

```python
from python.core.runtime.win_job_object import create_job_object
job = create_job_object()  # Browsers auto-terminate on parent exit
```

### Signal Handling
```python
# Handled signals: SIGINT, SIGTERM, SIGBREAK (Windows)
# Graceful shutdown closes browser contexts before exit
```

---

## File Paths

| Path | Purpose |
|------|---------|
| `python/data/profiles/<name>/` | Browser profile storage (cookies, localStorage) |
| `python/data/logs/bot.log` | Application logs |
| `python/data/debug/` | Error snapshots (screenshots, HTML) |
| `python/data/selector_cache.json` | Cached CSS selector strategies |

---

## Integration with Node.js Server

The Node.js server (`../server/`) spawns this Python module as child processes:

```typescript
// server/automation/spawn-python.ts
spawn('python', ['python/launcher.py', '--name', profileName, ...args])
```

Communication happens via:
- **stdout/stderr**: Parsed for JSON log lines
- **Exit codes**: 0 = success, non-zero = failure
- **Process signals**: SIGTERM for graceful shutdown

---

## Safety & Compliance

> ⚠️ **Warning**: Browser automation against third-party services may violate Terms of Service.

**Recommendations**:
- Use dedicated test accounts
- Keep interaction rates conservative
- Implement rate limiting and cooldowns
- Monitor for account restrictions
