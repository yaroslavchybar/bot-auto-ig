# Frontend (Anti)

React + Vite frontend for the Anti dashboard and automation UI. It provides pages for:

- Dashboard overview
- Profiles manager
- Lists manager
- Instagram automation controls and settings
- Live and file-based logs

## Tech Stack

- Vite 7 + React 19 + TypeScript
- Tailwind CSS + shadcn/ui (Radix UI primitives) + lucide-react icons
- Convex client (optional, for Convex-backed data/features)
- Backend integration:
  - HTTP API via `/api/*`
  - WebSocket via `/ws`

## Prerequisites

- Node.js 20+ (recommended)
- A running backend server on `http://localhost:3001` (for API + WebSocket)

## Local Development

From the repo root, run the backend and frontend in separate terminals.

1) Start the backend

```bash
cd server
npm install
npm run dev
```

2) Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open:

- Frontend: http://localhost:5173
- Backend: http://localhost:3001

### Dev Proxy

The Vite dev server proxies:

- `/api` -> `http://localhost:3001`
- `/ws` -> `ws://localhost:3001`

See [vite.config.ts](file:///c:/Users/yaros/Downloads/anti/frontend/vite.config.ts).

## Environment Variables

### `VITE_CONVEX_URL`

Convex deployment URL used by the frontend Convex client.

- Read from `import.meta.env.VITE_CONVEX_URL`
- Fallback default is hardcoded if unset

See [ConvexClientProvider.tsx](file:///c:/Users/yaros/Downloads/anti/frontend/src/components/ConvexClientProvider.tsx).

Example (PowerShell):

```powershell
$env:VITE_CONVEX_URL = "https://your-deployment.convex.cloud"
npm --prefix frontend run dev
```

Notes:

- In Docker, `VITE_CONVEX_URL` is injected at build time (not runtime).

## Backend Connectivity

### HTTP API

Most frontend API calls use relative paths (for example, `/api/profiles`) via [apiFetch](file:///c:/Users/yaros/Downloads/anti/frontend/src/lib/api.ts), so they work with:

- Vite proxy during development
- Nginx reverse-proxy in the Docker image

### WebSocket

Live logs/status use a WebSocket endpoint at:

- `ws://localhost:3001/ws` by default

See [useWebSocket](file:///c:/Users/yaros/Downloads/anti/frontend/src/hooks/useWebSocket.ts).

### Hardcoded API base (important)

Some Instagram UI components currently call the backend using an absolute base URL:

- `http://localhost:3001/api/...`

See [AutomationControls.tsx](file:///c:/Users/yaros/Downloads/anti/frontend/src/tabs/instagram/components/AutomationControls.tsx) and [SourceListsSelector.tsx](file:///c:/Users/yaros/Downloads/anti/frontend/src/tabs/instagram/components/SourceListsSelector.tsx).

If you deploy the backend on a different host/port, these calls must be updated (or refactored to use relative `/api/*` like the rest of the app).

## Scripts

From [package.json](file:///c:/Users/yaros/Downloads/anti/frontend/package.json):

- `npm run dev`: start Vite dev server
- `npm run build`: typecheck (`tsc -b`) and build production assets (`vite build`)
- `npm run preview`: serve the production build locally via Vite
- `npm run lint`: run ESLint

## Project Structure

- `src/main.tsx`: application bootstrap (ThemeProvider + Convex provider)
- `src/App.tsx`: sidebar layout and tab routing
- `src/tabs/*`: feature pages
  - `dashboard/`: overview widgets
  - `profiles/`: profile CRUD + login flow
  - `lists/`: list CRUD and assignment helpers
  - `instagram/`: automation settings and controls
  - `logs/`: live logs and log file viewer
- `src/components/ui/*`: shadcn/ui components
- `src/hooks/*`: reusable hooks (mobile detection, data hooks, WebSocket)
- `src/lib/*`: shared utilities (fetch wrapper, className utils)

## Production Build

Build the static assets:

```bash
cd frontend
npm run build
```

Output directory:

- `frontend/dist/`

Preview the production build locally:

```bash
cd frontend
npm run preview
```

## Docker

The recommended way to run the full system is via the repo-level Docker Compose.

From the repo root:

```bash
docker compose up --build
```

Ports (from [docker-compose.yml](file:///c:/Users/yaros/Downloads/anti/docker-compose.yml)):

- Frontend: http://localhost:5173 (Nginx serving the built SPA)
- Backend API/WebSocket: http://localhost:3001

### Nginx behavior

The container uses [nginx.conf](file:///c:/Users/yaros/Downloads/anti/frontend/nginx.conf) to:

- Serve the SPA with `try_files ... /index.html` (so refresh/deep links work)
- Reverse-proxy `/api/` and `/ws` to the `server` service on port 3001

### Build-time Convex configuration

The frontend image supports build arg:

- `VITE_CONVEX_URL`

This is wired in [frontend/Dockerfile](file:///c:/Users/yaros/Downloads/anti/frontend/Dockerfile) and Compose passes it via `build.args`.

## Troubleshooting

- API requests failing: ensure the backend is reachable on `http://localhost:3001`.
- WebSocket not connecting: ensure the backend exposes `/ws` on port 3001.
- Deployed behind a different host/port: update the hardcoded `API_BASE` usage in the Instagram components.

