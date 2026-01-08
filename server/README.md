# Anti Server

Backend API server for Instagram automation. Controls Python subprocesses, handles real-time WebSocket communication, and syncs data with Convex.

---

## Quick Reference

| Item | Value |
|------|-------|
| Entry point | `index.ts` |
| Default port | `3001` |
| WebSocket path | `/ws` |
| Python scripts | `../python/scripts/` |

---

## Directory Structure

```
server/
├── index.ts              # Server entry point, Express app, CORS, route mounting
├── websocket.ts          # WebSocket server for real-time log streaming
├── store.ts              # In-memory state (connected clients, logs, running processes)
│
├── api/                  # REST API endpoints
│   ├── automation.ts     # Start/stop automation, login
│   ├── profiles.ts       # CRUD profiles, start/stop browser
│   ├── lists.ts          # CRUD lists (profile groups)
│   ├── logs.ts           # Get/clear logs
│   └── instagram.ts      # Get/set Instagram settings
│
├── automation/           # Automation control logic
│   ├── runner.ts         # AutomationService class (connects to server API)
│   ├── manual-actions.ts # ManualAutomationService for per-profile browser control
│   ├── process-manager.ts# PID tracking for orphan cleanup
│   ├── state.ts          # State manager (tracks running automation)
│   └── shutdown.ts       # Cleanup handlers on shutdown
│
├── data/                 # Data access layer
│   ├── convex.ts         # Convex client and all Convex API calls
│   ├── profiles.ts       # ProfileManager class (file + Convex sync)
│   ├── lists.ts          # ListsService
│   └── messages.ts       # MessagesService
│
├── logs/                 # Logging utilities
│   ├── store.ts          # In-memory log store + file persistence
│   └── parser.ts         # Parse Python log output into structured entries
│
├── security/             # Auth & rate limiting middleware
│   ├── auth.ts           # Clerk authentication middleware
│   └── rate-limit.ts     # Rate limiters (API, automation)
│
├── helpers/              # Utility functions
│   ├── errors.ts         # Error codes and response helpers
│   ├── mutex.ts          # Async mutex for automation lock
│   ├── utils.ts          # General utilities
│   ├── user-agents.ts    # User agent strings
│   ├── settings-schema.ts# Validation for InstagramSettings
│   └── instagram-settings.ts # (placeholder)
│
├── types/                # TypeScript definitions
│   └── index.ts          # ActionName, LogEntry, InstagramSettings, etc.
│
└── session-logs/         # Generated log files (gitignored)
```

---

## Key Files

### `index.ts`
- Creates Express app and HTTP server
- Mounts all API routes under `/api/*`
- Applies Clerk auth and rate limiting middleware
- Initializes WebSocket on `/ws`
- Cleans up orphaned Python processes on startup

### `websocket.ts`
- WebSocket server with Clerk token authentication
- Broadcasts log entries and status changes to connected clients
- Maintains `clients` Set for active connections

### `store.ts`
- In-memory stores: `clients`, `logsStore`, `automationState`, `profileProcesses`
- Shared state between routes and WebSocket

---

## API Endpoints

### Health Check
```
GET /api/health
Response: { status: 'ok', timestamp: '...' }
```

### Automation

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/automation/status` | Get current status (`idle`, `running`, `stopping`) |
| POST | `/api/automation/start` | Start automation with settings (body: InstagramSettings) |
| POST | `/api/automation/stop` | Stop running automation |
| POST | `/api/automation/login` | Run login script for a profile |

### Profiles

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/profiles` | List all profiles |
| POST | `/api/profiles` | Create profile (body: `{ name, ...options }`) |
| PUT | `/api/profiles/:name` | Update profile |
| DELETE | `/api/profiles/:name` | Delete profile |
| POST | `/api/profiles/:name/start` | Launch browser for manual control |
| POST | `/api/profiles/:name/stop` | Stop browser |
| GET | `/api/profiles/assigned?list_id=X` | Profiles assigned to list |
| GET | `/api/profiles/unassigned` | Profiles not in any list |
| POST | `/api/profiles/bulk-set-list-id` | Assign multiple profiles to list |
| POST | `/api/profiles/generate-fingerprint` | Generate browser fingerprint |

### Lists

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/lists` | Get all lists |
| POST | `/api/lists` | Create list (body: `{ name }`) |
| PUT | `/api/lists/:id` | Update list name |
| DELETE | `/api/lists/:id` | Delete list |

### Logs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/logs` | Get in-memory logs |
| GET | `/api/logs/files` | List log files on disk |
| GET | `/api/logs/file/:name` | Load specific log file |
| DELETE | `/api/logs` | Clear all logs |

### Instagram Settings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/instagram/settings?scope=global` | Get settings |
| POST | `/api/instagram/settings` | Update settings |

---

## WebSocket Protocol

**Connection**: `ws://localhost:3001/ws?token=<clerk_jwt>`

### Server → Client Messages

```typescript
// Status change
{ type: 'status', status: 'idle' | 'running' | 'stopping' }

// Log entry
{ type: 'log', message: string, level: 'info' | 'warn' | 'error' | 'success', source: string }
```

---

## Types Reference

### `InstagramSettings`
```typescript
{
  automation_enabled: boolean;
  headless: boolean;
  max_sessions: number;
  parallel_profiles: number;
  action_order: ActionName[];
  source_list_ids: string[];
  // Feed settings
  enable_feed: boolean;
  feed_min_time_minutes: number;
  feed_max_time_minutes: number;
  like_chance: number;
  carousel_watch_chance: number;
  // Reels settings
  enable_reels: boolean;
  reels_min_time_minutes: number;
  reels_max_time_minutes: number;
  reels_like_chance: number;
  reels_follow_chance: number;
  reels_skip_chance: number;
  // Follow/Unfollow
  enable_follow: boolean;
  follow_chance: number;
  follow_min_count: number;
  follow_max_count: number;
  do_unfollow: boolean;
  unfollow_min_count: number;
  unfollow_max_count: number;
  // Stories
  watch_stories: boolean;
  stories_max: number;
  highlights_min: number;
  highlights_max: number;
  // Messaging
  do_message: boolean;
  messaging_cooldown_enabled: boolean;
  messaging_cooldown_hours: number;
  // Other
  use_private_profiles: boolean;
  profile_reopen_cooldown_enabled: boolean;
  profile_reopen_cooldown_minutes: number;
  do_approve: boolean;
  following_limit: number;
  min_delay: number;
  max_delay: number;
}
```

### `ActionName`
```typescript
'Feed Scroll' | 'Reels Scroll' | 'Watch Stories' | 'Follow' | 'Unfollow' | 'Approve Requests' | 'Send Messages'
```

### `LogEntry`
```typescript
{ ts: number; message: string; source?: string; level?: 'info' | 'warn' | 'error' | 'success' }
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SERVER_PORT` | No | Server port (default: 3001) |
| `CONVEX_URL` | Yes | Convex deployment URL |
| `CLERK_SECRET_KEY` | Yes | Clerk secret for JWT verification |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS origins |
| `NODE_ENV` | No | `production` for strict CORS |
| `PYTHON` | No | Python executable path (default: `python`) |

---

## External Dependencies

### Python Scripts (in `../python/`)
- `scripts/instagram_automation.py` — Main automation script
- `scripts/login_automation.py` — Login helper script
- `launcher.py` — Profile browser launcher

### Convex Backend
All persistent data stored in Convex:
- Profiles, Lists, Instagram Settings, Message Templates
- See `data/convex.ts` for all Convex function calls

---

## Commands

```bash
# Development (hot reload)
npm run dev

# Build TypeScript
npm run build

# Production
npm start

# Type check only
npx tsc --noEmit
```

---

## Docker

Build and run with the parent `docker-compose.yml`:
```bash
docker compose build server
docker compose up server
```

The Dockerfile:
1. Installs Node.js and Python dependencies
2. Downloads Camoufox browser and Playwright
3. Builds TypeScript
4. Runs via supervisord (Node + can manage Python)
