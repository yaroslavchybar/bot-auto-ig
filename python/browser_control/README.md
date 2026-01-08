# Browser Control

> **For AI Agents**: This folder manages the browser (Camoufox) and anti-detection features.

## Files

| File | Purpose |
|------|---------|
| `browser-setup.py` | Core browser initialization, proxy handling, page navigation |
| `fingerprint-generator.py` | Generate realistic browser fingerprints to avoid detection |

## Key Concepts

### Browser Setup
- Creates Camoufox browser contexts (Firefox fork with fingerprint spoofing)
- Handles proxy configuration (HTTP, SOCKS5, authenticated proxies)
- Manages persistent browser profiles (cookies, localStorage)
- Implements circuit breaker for proxy failures

### Fingerprint Generation
- Generates randomized but consistent browser fingerprints
- Spoofs: screen size, timezone, WebGL, user agent, etc.
- Uses Camoufox's built-in anti-detection features

## When to Modify

- **Adding new proxy formats?** → `browser-setup.py`
- **Changing fingerprint settings?** → `fingerprint-generator.py`
- **Browser crashes or detection issues?** → `browser-setup.py`
