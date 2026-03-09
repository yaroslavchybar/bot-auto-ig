# Frontend Guide

## Purpose

The frontend is a Clerk-protected React Router 7 + Vite operations app across profiles, lists, scraping, workflows, accounts upload, logs, VNC, and monitoring.

## Application Shape

Core app entrypoints:
- `frontend/src/root.tsx`: document shell, provider wiring, theme bootstrap, and top-level error handling.
- `frontend/src/entry.client.tsx`: hydrates the router on the client.
- `frontend/src/entry.server.tsx`: server-render entrypoint used by the React Router build.
- `frontend/src/routes.ts`: canonical route tree.

Route and UI structure:
- `frontend/src/routes/*`: route modules for auth, protected layout, and each feature path.
- `frontend/src/components/ui`: design-system primitives only.
- `frontend/src/components/shared`: cross-feature composites such as auth shell, confirm-delete dialog, logs viewer, and error views.
- `frontend/src/components/layout`: authenticated app shell pieces such as sidebar, theme toggle, user menu, auth guard, and Convex provider.
- `frontend/src/features/*`: feature-owned UI, containers, hooks, types, api modules, activities, and utils.
- `frontend/src/lib/*` and `frontend/src/hooks/*`: runtime/framework helpers and shared non-UI contracts.

Feature folders:
- `auth`
- `profiles`
- `lists`
- `scraping`
- `workflows`
- `accounts`
- `logs`
- `vnc`
- `monitoring`

## Route Surface

Protected routes under the authenticated shell:
- `/profiles`
- `/lists`
- `/scraping`
- `/workflows`
- `/accounts`
- `/logs`
- `/vnc`
- `/monitoring`

Other route behavior:
- `/` redirects to `/profiles`.
- `/sign-in/*` and `/sign-up/*` run through the auth layout.
- The protected shell keeps selected heavy routes mounted (`/workflows`, `/accounts`, `/logs`, `/vnc`) to avoid resetting long-lived client state on navigation.

## Runtime Integration

### API Access
- Default API base for authenticated fetches: `VITE_API_URL` or `http://localhost:3001`.
- Most UI calls use backend routes under `/api/*`.
- Profiles create/edit flows support pasted cookie JSON, while the cached profile list remains sanitized and fetches the sensitive cookie payload only from explicit profile detail reads.

### WebSocket
- Default endpoint resolves from the current browser host to `/ws`.
- Clerk token is appended as a query parameter when available.
- The client reconnects with exponential backoff and handles logs, status, workflow progression, and display-allocation events.

### Data Uploader Integration
- Data uploader base: `VITE_DATAUPLOADER_URL` or:
  - dev: `http://localhost:3002`
  - prod: `/api/datauploader`

### Convex Integration
- `VITE_CONVEX_URL` is required and normalized to HTTPS.
- `VITE_CONVEX_API_KEY` is used by the scraping task artifact flow.
- Scraping views may convert `.convex.cloud` origins to `.convex.site` storage URLs.

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
- `VITE_API_URL` (optional override)
- `VITE_DATAUPLOADER_URL` (optional override)
- `VITE_CONVEX_URL` (required)
- `VITE_CONVEX_API_KEY` (optional, used by scraping task artifact flow)

## Dev and Build

```bash
npm --prefix frontend run dev
npm --prefix frontend run build
npm --prefix frontend run lint
npm --prefix frontend run preview
```

## Verified Against

- `frontend/src/root.tsx`
- `frontend/src/routes.ts`
- `frontend/src/routes/index.tsx`
- `frontend/src/routes/protected-layout.tsx`
- `frontend/src/components/layout/ProtectedLayoutShell.tsx`
- `frontend/src/components/layout/app-sidebar.tsx`
- `frontend/src/components/shared/AuthCardShell.tsx`
- `frontend/src/components/shared/ConfirmDeleteDialog.tsx`
- `frontend/src/components/shared/LogsViewer.tsx`
- `frontend/src/css/base.css`
- `frontend/src/css/theme.css`
- `frontend/src/css/utilities.css`
- `frontend/src/index.css`
- `frontend/src/lib/env.ts`
- `frontend/src/hooks/useAuthenticatedFetch.ts`
- `frontend/src/hooks/useWebSocket.ts`
- `frontend/src/features/accounts/hooks/useDataUploader.ts`
- `frontend/src/features/scraping/containers/ScrapingPageContainer.tsx`
- `frontend/src/features/workflows/containers/WorkflowsPageContainer.tsx`
- `frontend/src/features/workflows/utils/workflowImportExport.ts`
- `frontend/src/features/monitoring/containers/MonitoringPageContainer.tsx`
- `frontend/src/entry.client.tsx`
- `frontend/src/entry.server.tsx`
