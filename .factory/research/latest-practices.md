# Latest Technology Best Practices Research

> **Generated:** 2026-03-13
> **Scope:** Key technologies used in bot-auto-ig project

---

## Table of Contents

1. [React 19](#1-react-19)
2. [React Router 7](#2-react-router-7)
3. [Vite 7](#3-vite-7)
4. [Convex](#4-convex)
5. [Node.js / Express](#5-nodejs--express)
6. [Camoufox](#6-camoufox)
7. [Playwright (Python)](#7-playwright-python)

---

## 1. React 19

**Project version:** `^19.2.3`
**Latest available:** 19.2.x (stable, released Dec 2024 — ongoing patches)

### New Features & Patterns

#### `use()` Hook
- New built-in hook for reading resources (Promises, Context) during render.
- Replaces many `useEffect` + `useState` combos for async data.
- Can be called conditionally (unlike other hooks).
```tsx
// ✅ Modern: use() for reading promises
import { use } from 'react';

function Comments({ commentsPromise }) {
  const comments = use(commentsPromise);
  return comments.map(c => <p key={c.id}>{c.text}</p>);
}
```

#### Actions & Form Handling
- **`useActionState`** (replaces the old `useFormState`): Manages async form action state.
- **`useFormStatus`**: Access pending state of the parent `<form>` from within child components.
- **`useOptimistic`**: Optimistic UI updates during async operations.
```tsx
// ✅ Modern form handling with Actions
import { useActionState } from 'react';

function AddToCart({ itemId }) {
  const [state, formAction, isPending] = useActionState(addToCartAction, null);
  return (
    <form action={formAction}>
      <input type="hidden" name="itemId" value={itemId} />
      <button disabled={isPending}>
        {isPending ? 'Adding...' : 'Add to Cart'}
      </button>
      {state?.error && <p>{state.error}</p>}
    </form>
  );
}
```

#### Ref as Prop (No More `forwardRef`)
- Function components now receive `ref` as a regular prop.
- `forwardRef` is deprecated — use `ref` prop directly.
```tsx
// ❌ Deprecated
const Input = forwardRef((props, ref) => <input ref={ref} {...props} />);

// ✅ React 19
function Input({ ref, ...props }) {
  return <input ref={ref} {...props} />;
}
```

#### React Compiler (Automatic Memoization)
- Experimental React Compiler auto-optimizes re-renders.
- Reduces need for manual `useMemo`, `useCallback`, `React.memo`.
- Not required — project can adopt incrementally.

#### Document Metadata
- `<title>`, `<meta>`, `<link>` in components are hoisted to `<head>` automatically.
```tsx
// ✅ Directly in component
function BlogPost({ post }) {
  return (
    <>
      <title>{post.title}</title>
      <meta name="description" content={post.summary} />
      <article>{post.content}</article>
    </>
  );
}
```

### Deprecated Patterns to Avoid

| Deprecated | Replacement |
|---|---|
| `forwardRef` | `ref` as a regular prop |
| `useFormState` (react-dom) | `useActionState` (react) |
| Legacy Context (`contextTypes`, `childContextTypes`) | `createContext` / `useContext` |
| String refs (`ref="myRef"`) | Callback refs or `useRef` |
| `React.createFactory` | JSX directly |
| `react-dom/test-utils` (`act`) | Import `act` from `react` |
| `ReactDOM.render` | `createRoot` (already deprecated since 18) |
| `propTypes` runtime checking | TypeScript types |

### Performance Best Practices
- Prefer `useTransition` for non-urgent updates (search, filtering).
- Use `useDeferredValue` to defer expensive re-renders.
- Leverage Suspense boundaries for loading states instead of manual loading flags.
- Keep component trees shallow; split large components.
- Use React DevTools Profiler to identify unnecessary renders.

---

## 2. React Router 7

**Project version:** `7.13.1` (with `@react-router/dev`, `@react-router/node`, `@react-router/serve`)
**Latest available:** 7.13.x (actively maintained)
**Mode:** Framework mode (file-based routing via `react-router dev`)

### Key Patterns

#### Type-Safe Routes (typegen)
- React Router generates route-specific types automatically.
- Run `react-router typegen` to generate types (already in `typecheck` script).
- Provides type-safe `params`, `loaderData`, and `actionData`.
```tsx
// routes/profiles.$profileId.tsx
import type { Route } from './+types/profiles.$profileId';

export async function loader({ params }: Route.LoaderArgs) {
  // params.profileId is typed as string
  return { profile: await getProfile(params.profileId) };
}

export default function ProfilePage({ loaderData }: Route.ComponentProps) {
  // loaderData.profile is fully typed
  return <h1>{loaderData.profile.name}</h1>;
}
```

#### Data Loading (Loaders & Actions)
- **Loaders** run before rendering to fetch data.
- **Actions** handle form submissions and mutations.
- Both exported from route modules in framework mode.
```tsx
// ✅ Route module pattern
export async function loader({ request, params }: Route.LoaderArgs) {
  return { data: await fetchData(params.id) };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  await processForm(formData);
  return { success: true };
}

export default function RouteComponent({ loaderData, actionData }: Route.ComponentProps) {
  return <div>{loaderData.data.title}</div>;
}
```

#### Framework Mode Conventions
- File-based routing configured in `routes.ts`.
- Route files export `loader`, `action`, `default` (component), `ErrorBoundary`, `meta`, `links`, `headers`.
- `root.tsx` is the app shell with `<Outlet />`.
- Use `<Link>`, `<NavLink>`, `<Form>` from `react-router` (not `react-router-dom`).

#### Pending UI & Optimistic Updates
```tsx
import { useNavigation, useFetcher } from 'react-router';

function Component() {
  const navigation = useNavigation();
  const isLoading = navigation.state === 'loading';
  
  // Fetcher for non-navigation mutations
  const fetcher = useFetcher();
  return (
    <fetcher.Form method="post" action="/api/action">
      <button>{fetcher.state === 'submitting' ? 'Saving...' : 'Save'}</button>
    </fetcher.Form>
  );
}
```

### Deprecated Patterns to Avoid

| Deprecated | Replacement |
|---|---|
| `json()` utility (from v6) | Return plain objects from loaders |
| `useLoaderData()` hook | Destructure `loaderData` from component props |
| `useActionData()` hook | Destructure `actionData` from component props |
| `V2_MetaFunction` | `meta` export in route module |
| Importing from `react-router-dom` | Import from `react-router` (unified package) |
| `defer()` + `Await` | Use `use()` hook from React 19 with promises |

### Breaking Changes / Migration Notes
- v7 unified `react-router` and `react-router-dom` — single package import.
- Framework mode is the spiritual successor to Remix.
- Type generation (`react-router typegen`) must run before `tsc` for type checking.

---

## 3. Vite 7

**Project version:** `^7.3.1`
**Latest available:** 7.3.x (released June 24, 2025)

### Major Changes in Vite 7

#### Node.js Support
- **Requires Node.js 20.19+ or 22.12+** (dropped Node 18).
- Needed for `require(esm)` support — Vite 7 is distributed as ESM only.

#### Default Browser Target
- Changed from `'modules'` to `'baseline-widely-available'`.
- New minimum browsers: Chrome 107, Edge 107, Firefox 104, Safari 16.0.

#### Rolldown Integration (Opt-in)
- `rolldown-vite` package: drop-in replacement for `vite` using Rust-based Rolldown bundler.
- Significantly faster builds for large projects.
- Will become default bundler in future Vite versions.
```bash
# Opt-in to Rolldown-powered builds
npm install rolldown-vite --save-dev
# Use as alias for vite in your config
```

#### Environment API (Experimental)
- New `buildApp` hook for coordinating multi-environment builds.
- Enables SSR, worker, and edge environment support in plugins.

#### Vite DevTools (New)
- Partnership between VoidZero and NuxtLabs.
- Deeper debugging and analysis for Vite-based projects.

### Configuration Best Practices
```ts
// vite.config.ts — Modern Vite 7 config
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    // Default is now 'baseline-widely-available'
    // Override only if needed:
    // target: 'esnext',
    
    // Enable source maps for production debugging
    sourcemap: true,
    
    // Rollup options for code splitting
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    // HMR is automatic
    hmr: true,
  },
});
```

### Deprecated / Removed in Vite 7

| Removed | Notes |
|---|---|
| Sass legacy API support | Use modern Sass API |
| `splitVendorChunkPlugin` | Use `rollupOptions.output.manualChunks` |
| Node.js 18 support | Minimum is 20.19+ or 22.12+ |
| CJS distribution | Vite is now ESM-only |

### Build Optimization Tips
- Use `rolldown-vite` for faster builds on large projects.
- Configure `manualChunks` for optimal code splitting.
- Use `build.cssCodeSplit: true` (default) for per-page CSS.
- Enable `build.reportCompressedSize: false` in CI for faster builds.
- Use Vitest 3.2+ for compatibility with Vite 7.

---

## 4. Convex

**Project version:** `^1.31.2` (convex), `^0.0.41` (convex-test), `^0.2.0` (@convex-dev/crons)
**Latest available:** 1.31.x (actively maintained)

### Critical Best Practices (from Official Docs)

#### 1. Always Include Table Name in `ctx.db` Calls (v1.31+)
```ts
// ❌ Old pattern (will be required in future)
await ctx.db.get(movieId);
await ctx.db.patch(movieId, { title: 'New' });
await ctx.db.delete(movieId);

// ✅ New pattern (v1.31+)
await ctx.db.get('movies', movieId);
await ctx.db.patch('movies', movieId, { title: 'New' });
await ctx.db.delete('movies', movieId);
```
- Use `@convex-dev/explicit-table-ids` ESLint rule to enforce.
- Use `@convex-dev/codemod` to auto-migrate existing code.

#### 2. Await All Promises
```ts
// ❌ Missing await — may silently fail
ctx.scheduler.runAfter(0, internal.foo.bar, {});

// ✅ Always await
await ctx.scheduler.runAfter(0, internal.foo.bar, {});
```
- Enable `no-floating-promises` ESLint rule.

#### 3. Use Indexes Instead of `.filter()`
```ts
// ❌ Scans entire table
const results = ctx.db.query('messages')
  .filter(q => q.eq(q.field('author'), 'Tom'))
  .collect();

// ✅ Uses index — fast and efficient
const results = await ctx.db.query('messages')
  .withIndex('by_author', q => q.eq('author', 'Tom'))
  .collect();
```

#### 4. Argument Validators for All Public Functions
```ts
// ✅ Always validate args
export const updateProfile = mutation({
  args: {
    id: v.id('profiles'),
    name: v.string(),
    bio: v.optional(v.string()),
  },
  handler: async (ctx, args) => { /* ... */ },
});
```
- Use `@convex-dev/require-argument-validators` ESLint rule.

#### 5. Use Internal Functions for Scheduling
```ts
// ❌ Scheduling public functions
await ctx.scheduler.runAfter(0, api.foo.bar, args);

// ✅ Schedule internal functions only
await ctx.scheduler.runAfter(0, internal.foo.bar, args);
```

#### 6. Use Helper Functions (Model Layer)
- Move business logic to `convex/model/` directory.
- Keep `query`/`mutation`/`action` wrappers thin.
- Share code between public and internal functions via helpers.

#### 7. Avoid `Date.now()` in Queries
- Use scheduled functions to set boolean flags instead.
- Or pass coarser time arguments from client (rounded to nearest minute).

#### 8. Only Use `.collect()` with Small Result Sets
- Use `.take(n)`, pagination, or indexes to limit results.
- Use `@convex-dev/no-query-collect` ESLint rule to enforce.

### Testing with convex-test (v0.0.41)

```ts
import { convexTest } from 'convex-test';
import { describe, it, expect, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

describe('profiles', () => {
  it('creates and lists profiles', async () => {
    const t = convexTest(schema);
    
    // Test with authentication
    const asUser = t.withIdentity({ name: 'TestUser' });
    await asUser.mutation(api.profiles.create, { name: 'Test' });
    
    const profiles = await asUser.query(api.profiles.list);
    expect(profiles).toHaveLength(1);
  });
  
  it('handles scheduled functions', async () => {
    vi.useFakeTimers();
    const t = convexTest(schema);
    
    await t.mutation(api.workflows.start, { type: 'sync' });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    
    vi.useRealTimers();
  });
});

const modules = import.meta.glob('./**/*.ts');
```

**Vitest Config for Convex Tests:**
```ts
// vitest.convex.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'edge-runtime',
    // For Vitest 4, use projects array for multi-environment
  },
});
```

### Recommended ESLint Rules
- `@convex-dev/no-query-collect` — prevent unbounded `.collect()`.
- `@convex-dev/require-argument-validators` — enforce validators on public functions.
- `@convex-dev/explicit-table-ids` — enforce table name in `ctx.db` calls.
- `no-floating-promises` — ensure all promises are awaited.

---

## 5. Node.js / Express

**Project versions:** Express `^4.21.0`, Node.js `^20.0.0` types (runtime likely 22.x)
**Latest available:** Express 4.21.x (Express 5 is available but still maturing), Node.js 22 LTS / 24 current

### Node.js 22+ Patterns

#### `require(esm)` — Enabled by Default
- Node.js 22.12+ supports `require()` of ESM modules without flags.
- Simplifies interop between CJS and ESM packages.

#### Built-in Test Runner
- `node:test` module is stable — alternative to external test frameworks.
- Not recommended if already using Vitest, but useful for lightweight testing.

#### Watch Mode
- `node --watch` is stable — auto-restarts on file changes.
- Project uses `tsx watch` which is similar but TypeScript-aware.

#### Performance Improvements
- V8 engine updates with Maglev compiler.
- `AbortSignal.any()` for combining abort signals.
- WebSocket client (`WebSocket` global) available.

### Express 4 Best Practices (2025-2026)

#### Structured Logging with Pino
```ts
import pino from 'pino';
import pinoHttp from 'pino-http';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty' }
    : undefined,
});

// HTTP request logging middleware
app.use(pinoHttp({ logger }));

// Use in routes
app.get('/api/health', (req, res) => {
  req.log.info('Health check requested');
  res.json({ status: 'ok' });
});
```

#### Error Handling
```ts
// ✅ Async error wrapper (Express 4 doesn't catch async errors automatically)
const asyncHandler = (fn: Function) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

app.get('/api/data', asyncHandler(async (req, res) => {
  const data = await fetchData();
  res.json(data);
}));

// ✅ Global error handler
app.use((err, req, res, next) => {
  req.log.error({ err }, 'Unhandled error');
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message,
  });
});
```

#### Security
```ts
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

app.use(helmet());
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
}));
```

#### TypeScript with tsx
```ts
// ✅ Project already uses tsx watch for dev
// scripts: { "dev": "tsx watch index.ts" }

// For production, compile with tsc then run:
// scripts: { "start": "node dist/index.js" }
```

### Express 5 Migration Notes (Future)
- Express 5 auto-catches async errors (no wrapper needed).
- `req.query` is always a plain object.
- `res.json()` and `res.send()` are more strict.
- Not recommended for migration yet — Express 5 ecosystem still maturing.

### Deprecated Patterns

| Deprecated | Replacement |
|---|---|
| `app.del()` | `app.delete()` |
| `req.param()` | `req.params`, `req.body`, `req.query` |
| Callback-based middleware | Async/await with error wrapper |
| `console.log` for logging | Structured logging (pino) |
| `process.env` without validation | Use dotenv + zod validation |

---

## 6. Camoufox

**Project version:** `camoufox[geoip]` (pinned via requirements.txt, version unspecified)
**Latest available:** Under active development (2026 releases are "highly experimental" per official docs)

### ⚠️ Important Status Notice (2026)

> **From official docs:** "Camoufox is under active development to get back to its original performance. The latest releases are highly experimental (expect breaking changes)."
>
> There was a ~1 year maintenance gap. The base Firefox version and new detection methods have reduced stealth performance. Pin your version carefully.

### Current API Patterns

#### Async Context Manager (Recommended)
```python
from camoufox.async_api import AsyncCamoufox

async with AsyncCamoufox(
    headless='virtual',  # Use Xvfb on Linux
    os='windows',        # Spoof target OS
    humanize=True,       # Humanize cursor movements
    geoip=True,          # Auto-detect geo from proxy IP
    proxy={
        'server': 'http://proxy:8080',
        'username': 'user',
        'password': 'pass',
    },
) as browser:
    page = browser.new_page()
    await page.goto('https://example.com')
```

#### Sync API
```python
from camoufox.sync_api import Camoufox

with Camoufox(headless=True) as browser:
    page = browser.new_page()
    page.goto('https://example.com')
```

### Key Parameters

| Parameter | Type | Description |
|---|---|---|
| `os` | `str \| list[str]` | Target OS fingerprint: `'windows'`, `'macos'`, `'linux'` |
| `headless` | `bool \| 'virtual'` | Headless mode. `'virtual'` uses Xvfb on Linux |
| `humanize` | `bool \| float` | Humanize cursor movement. Float = max duration in seconds |
| `geoip` | `str \| bool` | Auto-populate geolocation from IP. Pass IP or `True` for auto |
| `proxy` | `dict` | Playwright proxy config |
| `locale` | `str \| list[str]` | Locale(s) for Intl API |
| `block_images` | `bool` | Block image requests (save bandwidth) |
| `block_webrtc` | `bool` | Block WebRTC entirely |
| `disable_coop` | `bool` | Disable Cross-Origin-Opener-Policy (for Turnstile clicks) |
| `addons` | `list[str]` | Paths to extracted Firefox addons |
| `persistent_context` | `bool` | Persistent profile (requires `user_data_dir`) |
| `enable_cache` | `bool` | Enable page caching (default: False) |
| `main_world_eval` | `bool` | Allow main-world script injection with `mw:` prefix |
| `screen` | `Screen` | Constrain screen dimensions |
| `window` | `tuple[int, int]` | Fixed window size (debugging only — causes fingerprinting) |

### Stealth Best Practices
1. **Always use `geoip`** when using proxies — matches timezone, locale, coordinates.
2. **Don't set fixed window sizes** in production — let Camoufox generate naturally.
3. **Match OS to proxy location** — Windows fingerprint with US proxy, etc.
4. **Use `humanize=True`** for any interaction-heavy automation.
5. **Use `block_webrtc=True`** to prevent IP leaks.
6. **Use `disable_coop=True`** when interacting with Cloudflare Turnstile.
7. **Avoid `block_webgl=True`** unless necessary — it can cause detection.
8. **Use persistent contexts** for session continuity across runs.

### Deprecated / Changed
- Older `NewBrowser()` / `AsyncNewBrowser()` factory functions are being replaced by `Camoufox()` / `AsyncCamoufox()` context managers.
- `config` dict parameter for raw Firefox preferences — use with caution, library is designed to populate these automatically.
- Expect breaking changes in 2026 releases — pin versions.

---

## 7. Playwright (Python)

**Project version:** `playwright` (pinned via requirements.txt, version unspecified)
**Latest available:** 1.51.x (March 2026)

### Browser Context Management (Automation Focus)

#### Context Isolation
```python
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.firefox.launch()
        
        # Each context is isolated (cookies, storage, etc.)
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 720},
            user_agent='Custom UA',
            locale='en-US',
            timezone_id='America/New_York',
        )
        
        page = await context.new_page()
        await page.goto('https://example.com')
        
        # Save state for reuse
        await context.storage_state(path='state.json')
        
        # Restore state
        context2 = await browser.new_context(storage_state='state.json')
```

#### Persistent Context (for Camoufox Integration)
```python
# When using with Camoufox, the browser manages contexts
# But you can still use Playwright API for page interaction
async with AsyncCamoufox(persistent_context=True, user_data_dir='./profile') as context:
    page = await context.new_page()
    await page.goto('https://example.com')
```

### Best Practices for Automation (Not Testing)

#### 1. Smart Waiting (Avoid Fixed Timeouts)
```python
# ❌ Avoid fixed waits
await page.wait_for_timeout(5000)

# ✅ Wait for specific conditions
await page.wait_for_selector('.content', state='visible')
await page.wait_for_load_state('networkidle')
await page.wait_for_function('document.readyState === "complete"')
await page.wait_for_url('**/dashboard')
```

#### 2. Robust Element Selection
```python
# ✅ Prefer text-based and role-based locators
await page.get_by_role('button', name='Submit').click()
await page.get_by_text('Welcome').wait_for()
await page.get_by_label('Email').fill('user@example.com')

# ✅ Use locator chains for complex selections
await page.locator('.card').filter(has_text='Premium').locator('button').click()

# ❌ Avoid fragile CSS/XPath selectors
await page.click('#app > div:nth-child(3) > button.submit')
```

#### 3. Network Interception
```python
# Block unnecessary resources for speed
await context.route('**/*.{png,jpg,gif,svg}', lambda route: route.abort())
await context.route('**/analytics*', lambda route: route.abort())

# Intercept and modify requests
async def handle_route(route):
    headers = {**route.request.headers, 'X-Custom': 'value'}
    await route.continue_(headers=headers)

await context.route('**/api/**', handle_route)
```

#### 4. Error Recovery & Resilience
```python
from playwright.async_api import TimeoutError

async def safe_navigate(page, url, retries=3):
    for attempt in range(retries):
        try:
            await page.goto(url, wait_until='domcontentloaded', timeout=30000)
            return True
        except TimeoutError:
            if attempt < retries - 1:
                await page.reload()
            continue
    return False
```

#### 5. Cookie & Session Management
```python
# Export cookies
cookies = await context.cookies()

# Import cookies
await context.add_cookies([
    {'name': 'session', 'value': 'abc', 'domain': '.example.com', 'path': '/'}
])

# Full storage state (cookies + localStorage + sessionStorage)
state = await context.storage_state()
# Restore later
context = await browser.new_context(storage_state=state)
```

#### 6. Page Performance
```python
# Use stealth page creation
page = await context.new_page()

# Set reasonable default timeout
page.set_default_timeout(30000)
page.set_default_navigation_timeout(60000)

# Reuse pages when possible instead of creating new ones
# Close pages when done to free memory
await page.close()
```

### Deprecated Patterns

| Deprecated | Replacement |
|---|---|
| `page.click(selector)` | `page.locator(selector).click()` |
| `page.fill(selector, value)` | `page.locator(selector).fill(value)` |
| `page.type(selector, text)` | `page.locator(selector).press_sequentially(text)` |
| `page.$(selector)` | `page.locator(selector)` |
| `page.$$(selector)` | `page.locator(selector).all()` |
| `page.waitForSelector(selector)` | `page.locator(selector).wait_for()` |
| `elementHandle` methods | Use `locator` API (auto-waits, more reliable) |

### Version Notes
- Playwright 1.50+ has improved Firefox support.
- Locator API is the recommended way to interact with elements (auto-waits, auto-retries).
- `page.type()` renamed to `page.locator().press_sequentially()` for clarity.
- Always use `async_playwright` for async code (not sync API) in automation bots.

---

## Cross-Cutting Recommendations

### TypeScript
- Project uses TypeScript `^5.9.3` — latest features including `satisfies`, `const` type parameters, decorator metadata.
- Enable `strict: true` in all tsconfig files.
- Use `verbatimModuleSyntax: true` for clean ESM imports.

### Package Versions Summary

| Technology | Project Version | Latest Stable | Action Needed |
|---|---|---|---|
| React | ^19.2.3 | 19.2.x | ✅ Up to date |
| React Router | 7.13.1 | 7.13.x | ✅ Up to date |
| Vite | ^7.3.1 | 7.3.x | ✅ Up to date |
| Convex | ^1.31.2 | 1.31.x | ✅ Up to date |
| convex-test | ^0.0.41 | 0.0.41 | ✅ Up to date |
| Express | ^4.21.0 | 4.21.x | ✅ Up to date |
| TypeScript | ^5.9.3 | 5.9.x | ✅ Up to date |
| Vitest | ^4.0.18 | 4.x | ✅ Up to date |
| Camoufox | unspecified | experimental | ⚠️ Pin version |
| Playwright | unspecified | 1.51.x | ⚠️ Pin version |

### Priority Improvements
1. **Pin Python dependency versions** in `requirements.txt` (Camoufox and Playwright).
2. **Adopt table name syntax** for all `ctx.db` calls (Convex v1.31+).
3. **Replace `forwardRef`** with ref-as-prop pattern in React components.
4. **Add Convex ESLint rules** (`explicit-table-ids`, `require-argument-validators`, `no-query-collect`).
5. **Consider structured logging** (pino) for Express server.
6. **Use React Router type generation** for type-safe route params and loader data.
