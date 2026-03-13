# Frontend Guide

## Purpose

The frontend is a Clerk-protected React Router 7 + Vite operations app across profiles, lists, workflows, scraped data, accounts upload, logs, VNC, and monitoring. It now uses Clerk's React Router integration with SSR enabled so route auth and redirect behavior run on the server, not only after client render.

## Application Shape

Core app entrypoints:
- `frontend/src/root.tsx`: document shell, Clerk React Router middleware/loader wiring, provider bootstrap, and top-level error handling.
- `frontend/src/entry.client.tsx`: hydrates the router on the client.
- `frontend/src/entry.server.tsx`: server-render entrypoint used by the React Router build.
- `frontend/src/routes.ts`: canonical route tree.

Route and UI structure:
- `frontend/src/routes/*`: route modules for auth, protected layout, and each feature path.
- `frontend/src/components/ui`: design-system primitives only.
- `frontend/src/components/shared`: cross-feature composites such as auth shell, confirm-delete dialog, logs viewer, and error views.
- `frontend/src/components/layout`: authenticated app shell pieces such as sidebar, theme toggle, user menu, and Convex provider.
- `frontend/src/features/*`: feature-owned UI, containers, hooks, types, api modules, activities, and utils.
- `frontend/src/lib/*` and `frontend/src/hooks/*`: runtime/framework helpers and shared non-UI contracts.

Feature folders:
- `auth`
- `profiles`
- `lists`
- `workflows`
- `scraped-data`
- `accounts`
- `logs`
- `vnc`
- `monitoring`

## Route Surface

Protected routes under the authenticated shell:
- `/profiles`
- `/lists`
- `/workflows`
- `/workflows/:workflowId/editor` (immersive editor route without the global sidebar/top header; uses local editor controls)
- `/scraped-data`
- `/accounts`
- `/logs`
- `/vnc`
- `/monitoring`

## Workflow Editor

- Workflow activity nodes are schema-driven from `frontend/src/features/workflows/activities/*`.
- The right-side node settings panel renders grouped inputs directly from activity metadata; there is no separate modal/settings framework for workflow nodes.
- `start_browser` is the workflow-wide execution settings node for headless mode, parallel profile count, profile reopen cooldown, and messaging cooldown.
- `scrape_relationships` is the workflow-owned follower/following scraping node. It stores resumable runtime progress in workflow node state and exposes downloadable artifacts from workflow details.
- `/scraped-data` is the dedicated artifact-management page for all workflow scrape outputs. It uses Convex-authenticated workflow artifact queries and exposes download/delete actions without replacing the `/accounts` import flow.
- Existing workflows remain backward compatible with legacy `start_browser` cooldown keys; the editor normalizes them to the current config shape on load/save.
- `send_dm` node template management stays connected to shared Convex template banks and can switch between `message` and `message_2` from node config.
- The legacy `python_script` workflow node is no longer available in the block library or accepted by workflow import validation.

Other route behavior:
- `/` redirects server-side to `/profiles` when signed in and `/sign-in` when signed out.
- `/sign-in/*` and `/sign-up/*` run through the auth layout and redirect signed-in users back to `/profiles` from route loaders.
- The protected layout loader enforces signed-in access before rendering nested routes and preserves the original request URL through Clerk redirect params.
- The protected shell keeps selected heavy routes mounted (`/workflows`, `/accounts`, `/logs`, `/vnc`) to avoid resetting long-lived client state on navigation.
- The workflow editor route opts into immersive app chrome, so auth/providers stay mounted while the global sidebar and breadcrumb header are skipped.

## Runtime Integration

### Authentication
- Frontend auth uses `@clerk/react-router`, not `@clerk/clerk-react`.
- `frontend/src/root.tsx` registers `clerkMiddleware()` and `rootAuthLoader()`.
- The root route passes loader data into `ClerkProvider`, which makes session state available on both the server render and the client.
- Client-side `SignedIn` / `SignedOut` remain available for view branching, but access control is enforced by route loaders.

### API Access
- Default API base for authenticated fetches:
  - dev fallback: `http://localhost:3001`
  - prod: `VITE_API_URL` is required at build time
- Express remains the control plane for orchestration surfaces such as runtime reconciliation, browser launch/stop, logs, monitoring, VNC, and workflow execution.
- Profiles create/edit flows support pasted cookie JSON, while the cached profile list remains sanitized and fetches the sensitive cookie payload only from explicit profile detail reads.

### WebSocket
- Default endpoint resolves from the current browser host to `/ws`.
- Clerk token is appended as a query parameter when available.
- The client reconnects with exponential backoff and handles logs, status, workflow progression, and display-allocation events.

### VNC Transport
- Browser VNC sessions resolve to the same-origin path `/vnc/<port>/websockify` in non-local deployments so TLS terminates at the reverse proxy instead of at `websockify`.
- Local browser sessions on `localhost` / `127.0.0.1` keep using direct `ws://localhost:<port>/websockify` because the frontend dev server does not proxy dynamic VNC websocket ports.
- Production reverse proxies must forward `/vnc/<port>/websockify` to `server:<port>/websockify`.

### Data Uploader Integration
- Data uploader base:
  - dev fallback: `http://localhost:3002`
  - prod: `VITE_DATAUPLOADER_URL` is required at build time
- The React Router frontend no longer provides an `/api/datauploader` reverse proxy.

### Convex Integration
- `VITE_CONVEX_URL` is required and normalized to HTTPS.
- Browser data access for profiles, lists, workflows, workflow artifacts, and message templates goes directly through the Convex React client.
- `ConvexProviderWithClerk` uses Clerk auth tokens so every browser-facing Convex query and mutation runs with a Clerk identity.
- Protected layout rendering is gated with Convex auth state (`AuthLoading` / `Authenticated` / `Unauthenticated`) so feature query hooks mount only after Convex validates Clerk tokens.
- Browser code should not call `.convex.site/api/*` directly.
- Workflow scrape artifact download resolves storage URLs through authenticated workflow artifact helpers.

### Styling
- Tailwind CSS is configured in CSS-first mode from `frontend/src/index.css`.
- Frontend builds use the official Tailwind Vite plugin (`@tailwindcss/vite`) with Tailwind CSS 4.2.
- Semantic theme utilities (`bg-background`, `text-foreground`, `bg-sidebar`, etc.) are mapped from runtime CSS variables and use the root `.dark` class for dark mode.
- `frontend/src/index.css` imports the modular CSS files under `frontend/src/css/`.
- Design tokens and semantic Tailwind mappings live in `frontend/src/css/theme.css`.
- Global resets and runtime-only selectors live in `frontend/src/css/base.css`.
- Shared emerald brand-accent utilities live in `frontend/src/css/utilities.css`.
- Runtime theme state lives in `frontend/src/hooks/use-theme.tsx`, persists to `localStorage` under `anti-theme`, defaults to dark, and drives the HTML root class before React mounts.

## Workflow JSON Import/Export

Workflows supports:
- `Import JSON` from header actions.
- `Export JSON` from each workflow row action menu.

Export contract:
- Envelope shape:
  - `format: 'bot-auto-ig.workflow'`
  - `version: '1.0'`
  - `exportedAt` (ISO timestamp)
  - `workflow` with allowed fields only: `name`, `description`, `nodes`, `edges`
- Export never includes runtime metadata (`_id`, status, schedule, timestamps, etc.).

Import contract and validation:
- Accepts `.json` files only.
- Max file size: `2MB` (`2097152` bytes).
- Max graph size: `nodes <= 500`, `edges <= 2000`.
- Requires valid envelope format/version and required `workflow` fields.
- Graph checks:
  - node IDs must be non-empty and unique
  - every edge `source`/`target` must reference an existing node ID
  - at least one start node (`type === 'start'` or `id === 'start_node'`)
- Unknown activity IDs (`getActivityById`) hard-fail and list offending IDs.
- `select_list.config.sourceLists` IDs missing from current lists are warning-only.
- Persistence is create-only (`api.workflows.create`), never overwrites existing workflows.
- Name collisions auto-rename to `"<name> (imported YYYY-MM-DD HH:mm)"`.

## Environment Variables

- `VITE_CLERK_PUBLISHABLE_KEY` (required)
- `VITE_API_URL` (required for production builds; optional in local dev)
- `VITE_DATAUPLOADER_URL` (required for production builds; optional in local dev)
- `VITE_CONVEX_URL` (required)

## Dev and Build

```bash
npm --prefix frontend run dev
npm --prefix frontend run build
npm --prefix frontend run start
npm --prefix frontend run lint
npm --prefix frontend run preview
```

## Verified Against

- `frontend/src/root.tsx`
- `frontend/src/routes.ts`
- `frontend/src/routes/index.tsx`
- `frontend/src/routes/protected-layout.tsx`
- `frontend/src/routes/sign-in.tsx`
- `frontend/src/routes/sign-up.tsx`
- `frontend/src/components/layout/ProtectedLayoutShell.tsx`
- `frontend/src/components/layout/ConvexClientProvider.tsx`
- `frontend/src/components/layout/app-sidebar.tsx`
- `frontend/src/components/shared/AuthCardShell.tsx`
- `frontend/src/components/shared/ConfirmDeleteDialog.tsx`
- `frontend/src/components/shared/LogsViewer.tsx`
- `frontend/src/css/base.css`
- `frontend/src/css/theme.css`
- `frontend/src/css/utilities.css`
- `frontend/src/index.css`
- `frontend/src/lib/env.ts`
- `frontend/src/lib/auth-routing.ts`
- `frontend/src/lib/auth.server.ts`
- `frontend/src/hooks/useAuthenticatedFetch.ts`
- `frontend/src/hooks/useWebSocket.ts`
- `frontend/src/features/profiles/hooks/useProfiles.ts`
- `frontend/src/features/lists/hooks/useLists.ts`
- `frontend/src/features/accounts/hooks/useDataUploader.ts`
- `frontend/src/features/workflows/containers/WorkflowsPageContainer.tsx`
- `frontend/src/features/workflows/containers/WorkflowEditorPageContainer.tsx`
- `frontend/src/features/workflows/utils/workflowImportExport.ts`
- `frontend/src/features/monitoring/containers/MonitoringPageContainer.tsx`
- `frontend/src/entry.client.tsx`
- `frontend/src/entry.server.tsx`
