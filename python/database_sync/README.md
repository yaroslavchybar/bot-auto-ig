# Database Sync

> **For AI Agents**: This folder handles communication with the Convex backend database.

## Files

| File | Purpose |
|------|---------|
| `config.py` | Convex URL and API key configuration |
| `client.py` | Base HTTP client for Convex API |
| `accounts-client.py` | Instagram account data (credentials, cooldowns) |
| `profiles-client.py` | Browser profile management |
| `settings-client.py` | Automation settings (timing, chances) |
| `messages-client.py` | DM message templates |
| `shared-session.py` | Shared HTTP session for reuse |

## How It Works

```
Python Automation ←→ Convex Backend ←→ Frontend Dashboard
                          ↓
                    (PostgreSQL/etc)
```

The Python automation fetches configuration from Convex and reports status back.

## Environment Variables

Set in `.env` at repository root:
```ini
CONVEX_URL=https://your-deployment.convex.site
CONVEX_API_KEY=your-server-side-key
```

## When to Modify

- **Adding new data to sync?** → Create new client file
- **Changing what data is fetched?** → Modify relevant `*-client.py`
- **Connection issues?** → Check `config.py` and `client.py`
