# Server

Canonical documentation moved to:
- [docs/README.md](../docs/README.md)

Docs system contract:
- `docs/` is source of truth.
- `AGENTS.md` is a short navigation map.
# Scraper

Set `OPENROUTER_API_KEY` for browser screenshot decisions during automation.
Each scraper profile uses its saved Instagram `sessionid`, csrf cookie, and proxy.
Opening and closing a profile refreshes its cookies in Convex. Liker collection
and monitoring share 10 requests per rolling hour and a proxy-country sleep window.
Set `APIFY_API_KEY` for all account post discovery through Apify Instagram Post Scraper;
browser-cookie requests collect likers, and automation screenshots classify leads.
