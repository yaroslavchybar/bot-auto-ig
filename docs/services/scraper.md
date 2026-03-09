# Scraper Service

## Purpose

`scraper/` provides follower/following scraping via FastAPI and CLI flows.

## API Endpoints

- `GET /health`
- `POST /scrape/followers`
- `POST /scrape/following`

Both scrape endpoints support:
- auth username + session ID,
- target username,
- cursor-based chunk pagination,
- `chunk_limit` (`1..5000`),
- `max_pages` (`1..100`),
- optional proxy normalization.

## CLI Runtime

- `scraper/main.py` provides session manager + followers/following menu flow.

## Behavior Notes

- Session verification occurs before scraping.
- If session verification fails only because the probe could not fetch a test user ID, the scrape continues and logs the degraded verification state.
- Proxy input normalization supports multiple formats.
- Responses include `targetUsername`, `scraped`, `chunkLimit`, `cursor`, `nextCursor`, `hasMore`, `total`, and `users`.

## Deployment

- Compose service port: `3003`.

## Verified Against

- `scraper/api.py`
- `scraper/main.py`
- `scraper/modules/Sessions_Manager.py`
- `scraper/modules/Get_Followers.py`
- `scraper/modules/Get_Following.py`
