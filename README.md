# Anti-CLI: Advanced Instagram Automation & Antidetect

**Anti-CLI** is a sophisticated, privacy-focused Instagram automation tool designed to manage multiple accounts with high-level antidetect capabilities. Built with a hybrid architecture using **Python (Camoufox/Playwright)** for the automation engine and **React (Ink)** for a powerful Terminal User Interface (TUI).

It leverages **Convex** for centralized state management, allowing synchronized control over hundreds of profiles with intelligent scheduling, human-like behavior simulation, and fingerprint spoofing.

---

## 🚀 Key Features

### 🛡️ Antidetect & Security
*   **Camoufox Engine**: Built on top of `camoufox`, a specialized Firefox build that defeats bot detection (fingerprint spoofing for Canvas, WebGL, Fonts, Audio).
*   **Smart Proxy Support**: Native support for HTTP/SOCKS5 proxies with authentication.
*   **Fingerprint Randomization**: Automatically generates consistent unique fingerprints (OS, Screen Resolution, User Agent) per profile.
*   **GeoIP Validation**: Automatically checks proxy location to ensure consistency.
*   **2FA/TOTP Support**: Built-in handling for Two-Factor Authentication using TOTP.

### 🤖 Human-Like Automation
*   **Natural Interactions**: Random delays, non-linear mouse movements (`humanize=True`), and variable scrolling speeds.
*   **Smart Browsing (Feed & Reels)**:
    *   **Mixed Mode**: Simulates real usage by switching between Feed and Reels.
    *   Scrolls with configurable probabilities for Likes, Comments, and Follows.
    *   Skips content based on logic (e.g., skips boring reels quickly, watches interesting ones longer).
*   **Story & Carousel Interaction**:
    *   Watches Stories with configurable limits.
    *   Browses Carousels (with slide limits).
*   **Advanced Account Management**:
    *   **"Warm-up" Following**: Visits profile -> Watches Highlights -> Scrolls -> Likes -> *Then* Follows.
    *   **Unfollow Logic**: smart unfollowing strategies.
    *   **Approve Follow Requests**: Automates accepting pending follow requests.
*   **Direct Messaging**:
    *   Sends DMs using customizable templates.
    *   Respects strict cooldowns (e.g., "don't message same user for 2 hours").

### ⚡ Power Management
*   **Multi-Threading**: Run multiple browser profiles in parallel (configurable concurrency).
*   **Scheduler**:
    *   Daily session limits (e.g., "max 5 sessions per day").
    *   Cool-down timers (e.g., "wait 30 mins before reopening profile").
    *   Global daily resets via Database Cron jobs.
*   **Centralized Database**: All state (profiles, target accounts, settings, logs) is stored in Convex.

---

## 🏗️ Architecture

The system consists of three main components:

1.  **The Database (Convex)**: Acts as the "Brain". It stores:
    *   `profiles`: Browser profiles (proxy, user agent, cookies path).
    *   `instagram_accounts`: Target users to follow/message.
    *   `instagram_settings`: Global configuration (limits, probabilities).
    *   `logs`: Execution logs.
2.  **The TUI (Node.js/React)**: The "Control Center".
    *   Visual interface to manage profiles, lists, and settings.
    *   Spawns Python processes for automation.
    *   Displays real-time logs and status.
3.  **The Engine (Python)**: The "Worker".
    *   Headless (or visible) browser automation.
    *   Executes complex logic defined in `python/automation/`.

```mermaid
graph TD
    User[User] --> TUI[React TUI (npm start)]
    TUI --> |Spawns| Py[Python Runner]
    Py --> |Reads/Writes| DB[(Convex Database)]
    Py --> |Controls| Browser[Camoufox / Firefox]
    Browser --> |Interacts| IG[Instagram.com]
    DB --> |Cron Jobs| DB
```

---

## 🛠️ Installation

### Prerequisites
*   **Python 3.10+**
*   **Node.js 16+**
*   **Convex Account** (Free tier works)
*   **Docker** (Optional, for containerized deployment)

### 1. Clone & Setup
```bash
git clone <repository-url>
cd anti
```

### 2. Python Setup
Create a virtual environment and install dependencies:
```bash
# Windows
python -m venv venv
.\venv\Scripts\activate

# Linux/Mac
python3 -m venv venv
source venv/bin/activate

# Install requirements
pip install -r python/requirements.txt
playwright install firefox
```

### 3. Node.js TUI Setup
Install the TUI dependencies and build the project:
```bash
npm install
npm run build
```

### 4. Convex Setup
1.  Create a new project at [convex.dev](https://convex.dev).
2.  Run `npx convex dev` to initialize and deploy your Convex functions.
3.  The schema and functions are defined in the `convex/` directory.

### 5. Environment Variables
Create a `.env` file in the root directory:
```env
# Convex Configuration
CONVEX_DEPLOYMENT=dev:your-project-name
CONVEX_URL=https://your-project.convex.cloud
CONVEX_API_KEY=your-api-key

# Optional: Proxy Defaults
DEFAULT_PROXY=http://user:pass@host:port
```

---

## 🐳 Docker Deployment

For VPS or containerized environments, you can use Docker.

1.  **Configure `.env`** as shown above.
2.  **Run with Docker Compose**:
    ```bash
    docker-compose up -d
    ```
3.  **Access the TUI**:
    ```bash
    docker attach anti-instagram
    ```
    *(Detach with `Ctrl+P` then `Ctrl+Q`)*

See [DEPLOY.md](DEPLOY.md) for full deployment details.

---

## 🎮 Usage

### Option A: The TUI Dashboard (Recommended)
This is the primary way to use the tool.
```bash
npm start
```
*   **Navigation**: Use Arrow keys and Enter.
*   **Profiles**: Create, Edit, or Delete browser profiles.
*   **Automation**: Select profiles and run "Start Automation".
*   **Settings**: Tweak global probabilities (Like chance, Scroll time, etc.).

### Option B: CLI Direct Launch
Useful for debugging or single-task execution.

**1. Simple Launcher (`launcher.py`)**
Runs a single action for a specific profile immediately.
```bash
# Mixed mode (Feed + Reels) for 15 mins with interaction chances
python python/launcher.py --name "MyProfile" --action mixed --duration 15 --match-likes 20 --match-follows 5

# Watch stories and then scroll feed
python python/launcher.py --name "MyProfile" --action scroll --watch-stories 1 --stories-max 5

# Debug mode (Show cursor/browser)
python python/launcher.py --name "MyProfile" --action manual --show-cursor
```

**2. Production Runner (`scripts/instagram_automation.py`)**
This is the script used by the TUI. It pulls tasks from Convex and handles multi-threading.
```bash
python scripts/instagram_automation.py
# (Usually requires arguments passed by the TUI logic)
```

---

## ⚙️ Configuration Details

### Global Settings (in TUI/Database)
You can tweak these values in the `instagram_settings` table (or via TUI):
*   `feed_min_time` / `feed_max_time`: How long to scroll feed.
*   `reels_skip_chance`: % chance to skip a reel immediately.
*   `messaging_cooldown_hours`: Minimum time between DMs to the same user.
*   `profile_reopen_cooldown_minutes`: Security lockout after a session ends.

### Profile Structure
Each profile in `data/profiles/` contains:
*   **Cookies/Storage**: Persistent session data.
*   **Cache**: Browser cache.
*   **Fingerprint**: Unique hardware/software characteristics.

---

## 📂 Project Structure

```text
anti/
├── python/                 # Python Backend
│   ├── automation/         # Core Automation Logic
│   │   ├── Follow/         # Smart Follow Logic
│   │   ├── approvefollow/  # Approve Follow Requests
│   │   ├── login/          # Login Automation
│   │   ├── messaging/      # DM Logic
│   │   ├── scrolling/      # Feed & Reels Scrolling
│   │   ├── stories/        # Story Viewing
│   │   ├── unfollow/       # Unfollow Logic
│   │   ├── actions.py      # Action orchestrator
│   │   └── browser.py      # Camoufox/Playwright wrapper
│   ├── core/               # Resilience, Models, Persistence
│   ├── convex/              # DB Client wrappers
│   ├── tests/              # Python Unit Tests
│   ├── launcher.py         # CLI Entry point
│   └── supervisor.py       # Process Supervisor
├── scripts/                # Execution Scripts
│   ├── instagram_automation.py # Main Multi-thread Runner
│   └── login_automation.py     # Login Automation Script
├── source/                 # TUI Frontend (React + Ink)
│   ├── components/         # UI Components (Views, Lists)
│   ├── lib/                # TUI Logic (Convex, Services)
│   ├── tests/              # Frontend Tests
│   ├── types/              # TypeScript Definitions
│   ├── app.tsx             # TUI Entry point
│   └── cli.tsx             # CLI Entry point
├── convex/                 # Database Functions
│   └── migrations/         # SQL Schemas
├── Dockerfile              # Docker build file
├── docker-compose.yml      # Docker Compose config
└── data/                   # Local Data (Gitignored)
    └── profiles/           # Browser Profiles Storage
```

## 🐍 Core Module Internals (`python/core`)

The `python/core` directory contains the foundational building blocks of the automation engine, designed for resilience, observability, and state management.

### 1. Domain Models (`core/domain`)
Defines the strong types and configuration schemas used throughout the application.
- **`ScrollingConfig`**: A comprehensive configuration object controlling all automation aspects (probabilities for likes/follows, time limits, feature flags).
- **`ThreadsAccount`**: Credentials management for authenticating sessions.

### 2. Automation Primitives (`core/automation`)
Provides robust tools for browser interaction.
- **`SemanticSelector`**: A multi-strategy element locator that prioritizes accessibility attributes (Role, Label) over brittle CSS selectors. It automatically falls back to text or CSS if semantic locators fail, ensuring scripts survive UI updates.

### 3. Persistence Layer (`core/persistence`)
Manages state synchronization between the local filesystem and the Convex cloud database.
- **`ProfileManager`**: Handles the lifecycle of browser profiles.
    - **Dual Sync**: Keeps local `data/profiles` directories in sync with Convex records.
    - **Atomic Operations**: Ensures profile creations/deletions are transactionally safe across local disk and DB.
    - **Cloud-First**: Prioritizes database state as the source of truth.

### 4. Resilience & Reliability (`core/resilience`)
Ensures the bot continues to operate smoothly despite network hiccups or temporary failures.
- **`ResilientHttpClient`**: A custom HTTP client implementing the **Circuit Breaker** pattern to prevent cascading failures when external services are down.
- **`retry_with_backoff`**: A decorator implementing exponential backoff with jitter to handle transient errors gracefully.

### 5. Runtime Management (`core/runtime`)
Controls the execution environment and resource usage.
- **`ProcessManager`**: Spawns and monitors `camoufox` browser processes.
    - **Memory Watchdog**: Automatically restarts profiles that exceed memory limits (default 2GB).
    - **Orphan Cleanup**: Detects and kills zombie browser processes to free up system resources.

### 6. Observability (`core/observability`)
Provides deep insights into the bot's behavior.
- **Structured Logging**: Uses `JsonFormatter` to produce machine-readable logs (JSON) for easy parsing and analysis.
- **Snapshot Debugging**: Automatically captures page state (DOM snapshots) when selectors fail, aiding in rapid debugging.

## ⚠️ Disclaimer
This tool is for **educational and research purposes only**. Automating Instagram accounts may violate their Terms of Service. Use responsibly and at your own risk. The authors are not responsible for any account bans or restrictions.
