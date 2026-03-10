# Docker and Runtime Operations

## Full Stack Startup

From repository root:

```bash
docker compose up --build
```

## Services and Ports

- `server`: `http://localhost:3001`
- `frontend`: `http://localhost:5173`
- `datauploader`: `http://localhost:3002`
- `scraper`: `http://localhost:3003`
- VNC stack exposed by server container: `6080` and `6081-6130`

## Volumes

- `./data -> /app/data` (server)
- `./data/uploads -> /app/uploads` (datauploader)

## Frontend Build Args

- `VITE_API_URL`
- `VITE_CONVEX_URL`
- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_DATAUPLOADER_URL`

## Runtime Notes

- Frontend runtime should serve the React Router server build through `react-router-serve` so Clerk middleware/loaders and protected-route redirects execute server-side.
- Frontend still builds client and server bundles from the React Router SSR build output.
- Backend routes and WebSocket remain on server service.
- Datauploader and scraper run as separate FastAPI services.
- Non-local deployments can rely on same-origin defaults when the frontend sits behind the bundled proxy:
  - `VITE_API_URL` defaults to empty, so browser calls use `/api/*` on the current host.
  - `VITE_DATAUPLOADER_URL` defaults to `/api/datauploader`.
- Override `VITE_API_URL` and `VITE_DATAUPLOADER_URL` only when the browser must call a different public origin directly.

## Frontend Runtime Requirements

- Frontend runtime needs Clerk server-side auth variables in addition to build-time `VITE_*` values.
- `CLERK_SECRET_KEY` must be available to the frontend server runtime for Clerk React Router middleware/loader execution.
- `CLERK_PUBLISHABLE_KEY` or `VITE_CLERK_PUBLISHABLE_KEY` must be available consistently across build and runtime.
- Do not rely on a static-only frontend container if protected-route auth and redirect behavior must run on the server.

## Useful Commands

```bash
docker compose build server frontend datauploader scraper
docker compose up server
docker compose up frontend
docker compose ps
```

## Verified Against

- `docker-compose.yml`
- `frontend/Dockerfile`
- `server/Dockerfile`
- `datauploader/Dockerfile`
- `scraper/Dockerfile`
