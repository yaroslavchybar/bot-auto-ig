# Sentry SDK Integration Research

> Researched: 2026-03-13
> Sources: Official Sentry docs (docs.sentry.io), npm, PyPI

---

## 1. React Router 7 + Vite Frontend

### Package

| Package | Latest Version | Purpose |
|---|---|---|
| `@sentry/react-router` | ^10.38.0 | Core SDK for React Router v7 framework mode |
| `@sentry/vite-plugin` | ^5.1.1 | Source map upload during Vite builds (dev dependency) |
| `@sentry/profiling-node` | (optional) | Server-side profiling for SSR |

> **Note:** The `@sentry/react-router` SDK is currently marked **beta** by Sentry. It replaces the older `@sentry/react` + manual React Router integration for framework-mode apps.
> If using React Router in **data/declarative mode** (not framework mode), use `@sentry/react` instead with the React Router v7 integration from `@sentry/react/features/react-router/v7`.

### Installation

```bash
npm install @sentry/react-router
npm install @sentry/vite-plugin --save-dev
```

### Client-Side Initialization (`entry.client.tsx`)

```tsx
import * as Sentry from '@sentry/react-router';
import { startTransition, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';

Sentry.init({
  dsn: process.env.SENTRY_DSN, // or hardcoded DSN string
  environment: process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE, // ties errors to a specific deploy
  sendDefaultPii: true,

  integrations: [
    // Automatic React Router route-based tracing
    Sentry.reactRouterTracingIntegration(),
    // Session Replay (optional)
    Sentry.replayIntegration(),
  ],

  // Performance — lower in production
  tracesSampleRate: 1.0, // 1.0 = 100%, use 0.1–0.2 in prod
  tracePropagationTargets: [/^\//, /^https:\/\/your-api\.example\.com/],

  // Session Replay sampling
  replaysSessionSampleRate: 0.1, // 10% of sessions
  replaysOnErrorSampleRate: 1.0, // 100% of sessions with errors
});

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
```

### Error Boundary Integration (`app/root.tsx`)

```tsx
import * as Sentry from '@sentry/react-router';

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = 'Oops!';
  let details = 'An unexpected error occurred.';

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? '404' : 'Error';
    details = error.status === 404
      ? 'The requested page could not be found.'
      : error.statusText || details;
  } else if (error && error instanceof Error) {
    // Only capture non-404 errors
    Sentry.captureException(error);
    if (import.meta.env.DEV) {
      details = error.message;
    }
  }

  return (
    <main>
      <h1>{message}</h1>
      <p>{details}</p>
    </main>
  );
}
```

### Server-Side Initialization (`instrument.server.mjs`)

```js
import * as Sentry from '@sentry/react-router';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE,
  sendDefaultPii: true,
  tracesSampleRate: 1.0,
});
```

### Server Entry (`entry.server.tsx`)

```tsx
import * as Sentry from '@sentry/react-router';
import { createReadableStreamFromReadable } from '@react-router/node';
import { renderToPipeableStream } from 'react-dom/server';
import { ServerRouter } from 'react-router';

const handleRequest = Sentry.createSentryHandleRequest({
  ServerRouter,
  renderToPipeableStream,
  createReadableStreamFromReadable,
});

export default handleRequest;

export const handleError = Sentry.createSentryHandleError({
  logErrors: false,
});
```

### Loading Instrumentation on Startup (`package.json`)

```json
{
  "scripts": {
    "dev": "NODE_OPTIONS='--import ./instrument.server.mjs' react-router dev",
    "start": "NODE_OPTIONS='--import ./instrument.server.mjs' react-router-serve ./build/server/index.js"
  }
}
```

**Windows note:** Use `set NODE_OPTIONS=--import ./instrument.server.mjs` or use `cross-env`.

### Source Map Upload (`vite.config.ts`)

For React Router 7, use the `sentryReactRouter` wrapper (not the generic `sentryVitePlugin`):

```typescript
import { reactRouter } from '@react-router/dev/vite';
import { sentryReactRouter, type SentryReactRouterBuildOptions } from '@sentry/react-router';
import { defineConfig } from 'vite';

const sentryConfig: SentryReactRouterBuildOptions = {
  org: 'your-org',
  project: 'your-project',
  authToken: process.env.SENTRY_AUTH_TOKEN,
};

export default defineConfig((config) => {
  return {
    plugins: [reactRouter(), sentryReactRouter(sentryConfig, config)],
  };
});
```

Also add the build-end hook in `react-router.config.ts`:

```typescript
import type { Config } from '@react-router/dev/config';
import { sentryOnBuildEnd } from '@sentry/react-router';

export default {
  ssr: true,
  buildEnd: async ({ viteConfig, reactRouterConfig, buildManifest }) => {
    await sentryOnBuildEnd({ viteConfig, reactRouterConfig, buildManifest });
  },
} satisfies Config;
```

Store auth token in `.env.sentry-build-plugin` (auto-added to `.gitignore` by wizard):

```bash
SENTRY_AUTH_TOKEN=sntrys_YOUR_TOKEN_HERE
```

### Manual Error Capture (Client or Server)

```tsx
import * as Sentry from '@sentry/react-router';

// Capture exception
try {
  riskyOperation();
} catch (error) {
  Sentry.captureException(error);
}

// Capture message
Sentry.captureMessage('Something noteworthy happened');

// Custom span for performance
await Sentry.startSpan({ op: 'task', name: 'My Task' }, async () => {
  await doSomething();
});
```

### Best Practices — React Router 7 Frontend

1. **Initialize Sentry before anything else** — it must be the first import/call in entry files.
2. **Use `sentryReactRouter` for source maps**, not the generic `sentryVitePlugin`. The React Router wrapper handles both client and server source maps correctly.
3. **Lower sample rates in production** — `tracesSampleRate: 0.1` to `0.2` for tracing, `replaysSessionSampleRate: 0.1`.
4. **Set `tracePropagationTargets`** to your API domains to enable distributed tracing between frontend and backend.
5. **Delete source maps after upload** to prevent exposing source code publicly.
6. **Use `environment` and `release`** options to filter issues per deployment.
7. **Capture errors in the ErrorBoundary** — Sentry doesn't automatically capture errors caught by React error boundaries.

### Gotchas — React Router 7

- The `@sentry/react-router` SDK is in **beta** as of March 2026.
- Server-side auto-instrumentation via `--import` flag only works on **Node 20 < 20.19** and **Node 22 < 22.12**. For other versions, use the Instrumentation API (React Router 7.9.5+) or manual wrappers.
- On Windows, `NODE_OPTIONS` must be set differently — use `set` or `cross-env`.
- If deploying to Vercel/Netlify (can't set `NODE_OPTIONS`), import `instrument.server` directly at the top of `entry.server.tsx` — but this gives incomplete auto-instrumentation.

---

## 2. Express 4 Server (Node.js, TypeScript)

### Package

| Package | Latest Version | Purpose |
|---|---|---|
| `@sentry/node` | ^10.42.0 | Core SDK for Node.js (includes Express auto-instrumentation) |
| `@sentry/profiling-node` | (optional) | Node.js profiling |

> **Note:** There is no separate `@sentry/express` package. Express support is built into `@sentry/node` via auto-instrumentation.

### Installation

```bash
npm install @sentry/node
```

### Initialization (`instrument.ts`)

Create this file and ensure it's loaded **before all other imports**.

```typescript
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  release: process.env.SENTRY_RELEASE,
  sendDefaultPii: true, // captures request headers, IP

  // Performance monitoring
  tracesSampleRate: 1.0, // lower in production (0.1–0.2)

  // Optional: enable Sentry logs
  enableLogs: true,
});
```

### Express App Integration

```typescript
// Import instrument FIRST
import './instrument';

import express from 'express';
import * as Sentry from '@sentry/node';

const app = express();

// ... your routes and middleware ...

// IMPORTANT: Add Sentry error handler AFTER all routes
// but BEFORE any other error-handling middleware
Sentry.setupExpressErrorHandler(app);

// Your own error handler (runs after Sentry captures the error)
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(3000);
```

### Loading for ESM / TypeScript

For ESM or TypeScript compiled with ESM output:

```bash
node --import ./instrument.mjs app.mjs
```

For CommonJS:

```javascript
// At the very top of your entry file
require('./instrument');
```

For `ts-node` or `tsx`:

```bash
node --import ./instrument.ts app.ts
# or
node -r ./instrument.js app.js  # if pre-compiled
```

### Manual Error Capture

```typescript
import * as Sentry from '@sentry/node';

// In a route handler or middleware
app.get('/api/action', async (req, res) => {
  try {
    await riskyDatabaseCall();
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// Capture a message
Sentry.captureMessage('User exceeded rate limit', 'warning');

// Custom performance span
app.get('/api/data', async (req, res) => {
  const result = await Sentry.startSpan(
    { op: 'db.query', name: 'Fetch user data' },
    async () => {
      return await db.query('SELECT * FROM users');
    },
  );
  res.json(result);
});
```

### Enriching Events

```typescript
import * as Sentry from '@sentry/node';

// Set user context
Sentry.setUser({ id: userId, email: userEmail });

// Set tags (searchable)
Sentry.setTag('account_id', accountId);

// Set context (not searchable, shown in event details)
Sentry.setContext('automation', {
  workflow_id: workflowId,
  step: currentStep,
});
```

### Source Maps for Express Server

```bash
npx @sentry/wizard@latest -i sourcemaps
```

Or manually with `@sentry/vite-plugin` (if using Vite to build server) or upload via `sentry-cli`:

```bash
sentry-cli sourcemaps upload --org your-org --project your-project ./dist
```

### Best Practices — Express 4

1. **Import the instrumentation file before everything else.** This is critical for auto-instrumentation of HTTP, database drivers, etc.
2. **Place `Sentry.setupExpressErrorHandler(app)` after all routes** but before your custom error middleware.
3. **Use `sendDefaultPii: true`** to capture request data (headers, IP). Ensure GDPR compliance if needed.
4. **Set `release`** to correlate errors with specific deployments (e.g., git SHA or version tag).
5. **Lower `tracesSampleRate`** in production (0.1–0.2).
6. **Use `Sentry.setUser()`** for authenticated requests so errors are tied to users.

### Gotchas — Express 4

- Sentry must be initialized **before** importing Express or any other modules for auto-instrumentation to work.
- `setupExpressErrorHandler` must be the **last middleware before your error handler** — if placed before routes, it won't catch route errors.
- Node version must be ≥ 18.0.0 (≥ 18.19.0 or ≥ 19.9.0 recommended). Auto-instrumentation uses OpenTelemetry under the hood in v10+.
- The SDK automatically instruments: HTTP requests, Express middleware, common database drivers (pg, mysql, mongodb), and more.

---

## 3. Python Automation Scripts (Standalone)

### Package

| Package | Latest Version | Purpose |
|---|---|---|
| `sentry-sdk` | ^2.x (latest on PyPI as of Feb 2026) | Core Python SDK |

> No extra integrations needed for standalone scripts. The SDK works out of the box without Django, Flask, or any framework.

### Installation

```bash
pip install sentry-sdk
```

### Initialization

Initialize **as early as possible** in your script:

```python
import sentry_sdk

sentry_sdk.init(
    dsn=os.environ.get("SENTRY_DSN"),
    environment=os.environ.get("SENTRY_ENVIRONMENT", "production"),
    release=os.environ.get("SENTRY_RELEASE"),
    send_default_pii=True,

    # Performance monitoring (for standalone scripts)
    traces_sample_rate=1.0,  # lower in production

    # Optional: enable Sentry logs
    enable_logs=True,
)
```

### Automatic Error Capture

The SDK automatically captures **unhandled exceptions** in standalone scripts. No extra code needed:

```python
import sentry_sdk

sentry_sdk.init(dsn="...")

# This will be automatically reported to Sentry
raise ValueError("Something went wrong")
```

### Manual Error Capture

```python
import sentry_sdk

try:
    risky_operation()
except Exception as e:
    sentry_sdk.capture_exception(e)

# Or capture the current exception from sys.exc_info()
try:
    another_operation()
except Exception:
    sentry_sdk.capture_exception()  # no argument needed
```

### Manual Message Capture

```python
import sentry_sdk

sentry_sdk.capture_message("Script completed successfully", level="info")
sentry_sdk.capture_message("Rate limit approaching", level="warning")
```

### Enriching Events with Context

```python
import sentry_sdk

# Set user context
sentry_sdk.set_user({"id": account_id, "username": account_name})

# Set tags (searchable in Sentry UI)
sentry_sdk.set_tag("account_id", account_id)
sentry_sdk.set_tag("workflow", workflow_name)

# Set structured context (viewable on event page, not searchable)
sentry_sdk.set_context("automation", {
    "workflow_id": workflow_id,
    "step": current_step,
    "account": account_name,
})
```

### Performance Monitoring for Scripts

For standalone scripts you can manually create transactions/spans:

```python
import sentry_sdk

with sentry_sdk.start_transaction(op="automation", name="Run Workflow"):
    with sentry_sdk.start_span(op="step", description="Login"):
        perform_login()

    with sentry_sdk.start_span(op="step", description="Execute actions"):
        execute_actions()

    with sentry_sdk.start_span(op="step", description="Upload results"):
        upload_results()
```

### Flushing Events Before Exit

**Critical for scripts:** Sentry sends events asynchronously. If your script exits quickly, events may be lost. Always flush before exit:

```python
import sentry_sdk
import atexit

sentry_sdk.init(dsn="...")

# Option 1: Flush at exit
atexit.register(lambda: sentry_sdk.flush(timeout=5))

# Option 2: Flush explicitly at the end
def main():
    try:
        do_work()
    except Exception:
        sentry_sdk.capture_exception()
    finally:
        sentry_sdk.flush(timeout=5)  # wait up to 5 seconds

main()
```

### Async Scripts

For async scripts, init inside the async function:

```python
import asyncio
import sentry_sdk

async def main():
    sentry_sdk.init(
        dsn=os.environ.get("SENTRY_DSN"),
        traces_sample_rate=1.0,
    )

    try:
        await do_async_work()
    except Exception:
        sentry_sdk.capture_exception()
    finally:
        sentry_sdk.flush(timeout=5)

asyncio.run(main())
```

### Best Practices — Python Scripts

1. **Initialize as early as possible** — before any imports that could throw.
2. **Always call `sentry_sdk.flush()`** before your script exits. Scripts don't have a long-running event loop, so events can be lost.
3. **Use `atexit.register`** as a safety net for unexpected exits.
4. **Set `environment`** to distinguish between dev, staging, production errors.
5. **Set `release`** to track which version of scripts is producing errors.
6. **Use `set_user()` and `set_tag()`** to associate errors with specific automation accounts.
7. **Use `set_context()`** to attach workflow/step metadata to errors.
8. **Wrap long-running scripts in transactions** for performance visibility.
9. **For async code**, initialize inside the async function.

### Gotchas — Python Scripts

- **Events are async** — if the script exits immediately after an error, the event may never be sent. Always `flush()`.
- **No framework auto-instrumentation** — in standalone scripts, you only get unhandled exception capture and manual capture. No request/response instrumentation.
- **`capture_exception()` with no argument** captures the current exception from `sys.exc_info()`. Call it inside an `except` block.
- **Python 3.12 compatibility** — sentry-sdk 2.x fully supports Python 3.12.
- **Don't initialize in `__init__.py`** or module-level code that might run multiple times.

---

## 4. Cross-Platform Considerations

### Environment Variables (shared across all platforms)

| Variable | Purpose | Used By |
|---|---|---|
| `SENTRY_DSN` | Data Source Name — connects app to Sentry project | All |
| `SENTRY_ENVIRONMENT` | Environment name (development, staging, production) | All |
| `SENTRY_RELEASE` | Release/version identifier (e.g. git SHA) | All |
| `SENTRY_AUTH_TOKEN` | Auth token for source map uploads | Frontend build, Server build |

### Distributed Tracing (Frontend ↔ Express)

To correlate frontend and backend traces:

1. **Frontend:** Set `tracePropagationTargets` to include your API domain:
   ```ts
   tracePropagationTargets: [/^\//, /^https:\/\/your-api\.example\.com/]
   ```

2. **Express:** Sentry auto-instruments incoming requests and propagates trace context from `sentry-trace` and `baggage` headers.

No extra configuration needed on the Express side — `@sentry/node` v10+ handles this automatically.

### Release Tracking

Use the same `release` value across frontend and server to correlate issues:

```bash
# In CI/CD
export SENTRY_RELEASE=$(git rev-parse --short HEAD)
```

### Recommended Sample Rates by Environment

| Environment | `tracesSampleRate` | `replaysSessionSampleRate` | `replaysOnErrorSampleRate` |
|---|---|---|---|
| Development | 1.0 | 0 | 0 |
| Staging | 1.0 | 0.5 | 1.0 |
| Production | 0.1–0.2 | 0.1 | 1.0 |
