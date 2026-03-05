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
- overall limit,
- cursor/chunk pagination,
- max pages,
- optional proxy normalization.

## CLI Runtime

- `scraper/main.py` provides session manager + followers/following menu flow.

## Behavior Notes

- Session verification occurs before scraping.
- Proxy input normalization supports multiple formats.
- Responses include paging metadata and user payloads.

## Deployment

- Compose service port: `3003`.

## Verified Against

- `scraper/api.py`
- `scraper/main.py`
- `scraper/modules/Sessions_Manager.py`
- `scraper/modules/Get_Followers.py`
- `scraper/modules/Get_Following.py`
