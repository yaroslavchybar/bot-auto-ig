# Internal Systems

> ⚠️ **Warning**: Don't modify these files unless you're experienced with Python. These are core infrastructure components.

## Subfolders

| Folder | Purpose |
|--------|---------|
| `error-handling/` | Error classification, retry logic, circuit breakers |
| `logging/` | Log configuration, debug snapshots, observability |
| `storage/` | Local data persistence (cache, state files) |
| `process-management/` | Health checks, process control, signal handling |
| `data-models/` | Data classes (ScrollingConfig, account models) |
| `shared-utilities/` | Shared automation helpers |

## What Each Does

### Error Handling
Routes exceptions to recovery strategies:
- `ABORT` → Stop immediately (banned account, login required)
- `RETRY` → Try again with backoff (network errors)
- `RESTART_BROWSER` → Close and reopen browser
- `BACKOFF_AND_SLOW` → Wait and continue (rate limits)

### Logging
- JSON logs to `data/logs/bot.log`
- Console output with colors
- Debug screenshots on errors

### Storage
- Browser selector cache
- Local state persistence

### Process Management
- Windows Job Objects for child process cleanup
- Health checks (internet, disk, proxy)
- Signal handling (SIGTERM, SIGINT)

## When to Modify

**Only modify if:**
- Adding new error types → `error-handling/`
- Changing log format → `logging/`
- Adding new data models → `data-models/`
