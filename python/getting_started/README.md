# Getting Started

> **For AI Agents**: This folder contains the main entry points to run Instagram automation.

## Files

| File | Purpose |
|------|---------|
| `launcher.py` | Run a single Instagram session with one account |
| `run-multiple-accounts.py` | Run automation for multiple accounts at once |

## Quick Start

```bash
# Run one session (manual mode for testing)
python getting-started/launcher.py --name my_profile --proxy None --action manual

# Run automated scrolling
python getting-started/launcher.py --name my_profile --action scroll --duration 10
```

## When to Use

- **Adding new automation modes?** → Look at `instagram-actions/`
- **Fixing browser issues?** → Look at `browser-control/`
- **Changing database sync?** → Look at `database-sync/`
