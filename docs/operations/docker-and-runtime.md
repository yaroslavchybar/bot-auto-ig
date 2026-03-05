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

- `VITE_CONVEX_URL`
- `VITE_CLERK_PUBLISHABLE_KEY`

## Runtime Notes

- Frontend container serves static SPA through Nginx.
- Backend routes and WebSocket remain on server service.
- Datauploader and scraper run as separate FastAPI services.

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
