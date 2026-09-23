# Server

Canonical documentation moved to:
- [docs/README.md](../docs/README.md)

Docs system contract:
- `docs/` is source of truth.
- `AGENTS.md` is a short navigation map.
# Scraper

Set `OPENROUTER_API_KEY` in the server environment for regular GPT-6 Luna
profile-picture descriptions and TypeSafe Jev classification. Each scraper account uses its
saved Instagram `sessionid` and proxy. Opening a profile refreshes that cookie
in Convex. Scraper limits reset at midnight UTC and default to 1,000 processed
liker IDs per account per day.
Set `APIFY_API_KEY` for the Apify Instagram Post Scraper. It finds recent posts;
our Instagram accounts still collect likers and enrich leads.
