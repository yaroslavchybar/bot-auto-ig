# Anti-CLI: Advanced Instagram Automation & Antidetect

**Anti-CLI** is a sophisticated, privacy-focused Instagram automation tool designed to manage multiple accounts with high-level antidetect capabilities. Built with a hybrid architecture using **Python (Camoufox/Playwright)** for the automation engine and **React (Ink)** for a powerful Terminal User Interface (TUI).

It leverages **Supabase** for centralized state management, allowing synchronized control over hundreds of profiles with intelligent scheduling, human-like behavior simulation, and fingerprint spoofing.

---

## 🚀 Key Features

### 🛡️ Antidetect & Security
*   **Camoufox Engine**: Built on top of `camoufox`, a specialized Firefox build that defeats bot detection (fingerprint spoofing for Canvas, WebGL, Fonts, Audio).
*   **Smart Proxy Support**: Native support for HTTP/SOCKS5 proxies with authentication.
*   **Fingerprint Randomization**: Automatically generates consistent unique fingerprints (OS, Screen Resolution, User Agent) per profile.
*   **GeoIP Validation**: Automatically checks proxy location to ensure consistency.

### 🤖 Human-Like Automation
*   **Natural Interactions**: Random delays, non-linear mouse movements (`humanize=True`), and variable scrolling speeds.
*   **Smart Feed/Reels Browsing**:
    *   Scrolls feed and reels with configurable probabilities for Likes, Comments, and Follows.
    *   Watches Stories and Carousels (with slide limits).
    *   Skips content based on logic (e.g., skips boring reels quickly, watches interesting ones longer).
*   **"Warm-up" Following**:
    *   Does not just click "Follow".
    *   Visits target profile -> Watches Highlights -> Scrolls Posts -> Likes random posts -> *Then* Follows.
*   **Direct Messaging**:
    *   Sends DMs using customizable templates.
    *   Respects strict cooldowns (e.g., "don't message same user for 2 hours").

### ⚡ Power Management
*   **Multi-Threading**: Run multiple browser profiles in parallel (configurable concurrency).
*   **Scheduler**:
    *   Daily session limits (e.g., "max 5 sessions per day").
    *   Cool-down timers (e.g., "wait 30 mins before reopening profile").
    *   Global daily resets via Database Cron jobs.
*   **Centralized Database**: All state (profiles, target accounts, settings, logs) is stored in Supabase.

---

## 🏗️ Architecture

The system consists of three main components:

1.  **The Database (Supabase)**: Acts as the "Brain". It stores:
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
    Py --> |Reads/Writes| DB[(Supabase PostgreSQL)]
    Py --> |Controls| Browser[Camoufox / Firefox]
    Browser --> |Interacts| IG[Instagram.com]
    DB --> |Cron Jobs| DB
```

---

## 🛠️ Installation

### Prerequisites
*   **Python 3.10+**
*   **Node.js 16+**
*   **Supabase Account** (Free tier works)

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
pip install camoufox supabase python-dotenv requests playwright
playwright install firefox
```

### 3. Node.js TUI Setup
Install the TUI dependencies and build the project:
```bash
npm install
npm run build
```

### 4. Supabase Setup
1.  Create a new project at [supabase.com](https://supabase.com).
2.  Go to the **SQL Editor** in Supabase.
3.  Copy the content of `supabase/migrations/202512210001_initial_schema.sql` and run it.
    *   *Note: This creates all necessary tables (`profiles`, `instagram_accounts`, etc.) and sets up Cron jobs.*

### 5. Environment Variables
Create a `.env` file in the root directory:
```env
# Supabase Configuration
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-anon-key
SUPABASE_SECRET_KEY=your-service-role-key

# Optional: Proxy Defaults
DEFAULT_PROXY=http://user:pass@host:port
```
*Tip: You need the `SERVICE_ROLE` key (not just Anon) for backend operations.*

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
# Scroll feed for 10 minutes with 20% like chance
python python/launcher.py --name "MyProfile" --action scroll --duration 10 --match-likes 20

# Debug mode (Show cursor)
python python/launcher.py --name "MyProfile" --action manual --show-cursor
```

**2. Production Runner (`scripts/instagram_automation.py`)**
This is the script used by the TUI. It pulls tasks from Supabase and handles multi-threading.
```bash
python scripts/instagram_automation.py
# (Usually requires arguments passed by the TUI logic)
```

---

## ⚙️ Configuration Details

### Global Settings (in TUI/Database)
You can tweak these values in the `instagram_settings` table (or via TUI):
*   `feed_min_time` / `feed_max_time`: How long to scroll feed.
*   `reels_skip_chance`: % chance to skip a reel immediately (simulating disinterest).
*   `messaging_cooldown_hours`: Minimum time between DMs to the same user.
*   `profile_reopen_cooldown_minutes`: Security lockout after a session ends.

### Profile Structure
Each profile in `data/profiles/` contains:
*   **Cookies/Storage**: Persistent session data (no need to login every time).
*   **Cache**: Browser cache (cleared intelligently).
*   **Fingerprint**: Unique hardware/software characteristics.

---

## 📂 Project Structure

```text
anti/
├── python/                 # Python Backend
│   ├── automation/         # Core Automation Logic
│   │   ├── Follow/         # Smart Follow Logic (Pre-interactions)
│   │   ├── scrolling/      # Feed/Reels Scrolling behavior
│   │   ├── actions.py      # Action orchestrator
│   │   └── browser.py      # Camoufox/Playwright wrapper
│   ├── core/               # Models & Managers
│   ├── supabase/           # DB Client wrappers
│   └── launcher.py         # CLI Entry point
├── scripts/                # Execution Scripts
│   └── instagram_automation.py # Main Multi-thread Runner
├── source/                 # TUI Frontend (React + Ink)
│   ├── components/         # UI Components (Views, Lists)
│   ├── lib/                # TUI Logic (Supabase, Service calls)
│   └── app.tsx             # TUI Entry point
├── supabase/               # Database
│   └── migrations/         # SQL Schemas
└── data/                   # Local Data (Gitignored)
    └── profiles/           # Browser Profiles Storage
```

## ⚠️ Disclaimer
This tool is for **educational and research purposes only**. Automating Instagram accounts may violate their Terms of Service. Use responsibly and at your own risk. The authors are not responsible for any account bans or restrictions.
