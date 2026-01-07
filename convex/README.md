# Convex backend (`convex/`)

This directory contains the Convex backend for this project:

- The database schema (`schema.ts`)
- Public queries/mutations used by the app
- Internal jobs/actions used by scheduled cron jobs
- An HTTP API surface implemented as Convex HTTP Actions (`http.ts`)

## What’s in here

- `schema.ts`: Convex database schema and indexes
- `lists.ts`: CRUD for “lists”
- `profiles.ts`: CRUD + allocation helpers for “profiles”
- `instagramAccounts.ts`: account ingestion, assignment, status changes, and scheduled automation
- `instagramSettings.ts`: key/value settings storage (scoped)
- `messageTemplates.ts`: template storage per kind
- `dashboard.ts`: lightweight stats query for UI
- `http.ts`: HTTP endpoints under `/api/*` with CORS and optional bearer auth
- `crons.ts`: daily scheduled jobs

## Development

### Generate Convex types

Convex generates `_generated/*` based on the functions and schema in this folder.

```bash
npx convex dev
```

### Deploy

```bash
npx convex deploy
```

## Environment variables

### `CONVEX_API_KEY` (optional)

The HTTP API in `http.ts` checks for `CONVEX_API_KEY` at runtime.

- If `CONVEX_API_KEY` is set: every `/api/*` request must include `Authorization: Bearer <CONVEX_API_KEY>`
- If `CONVEX_API_KEY` is not set: requests are not authenticated (public)

## Data model

All tables live in the Convex database and are defined in `schema.ts`.

### `lists`

- Fields: `name: string`, `createdAt: number`

### `profiles`

- Fields:
  - `createdAt: number`
  - `name: string`
  - `proxy?: string`, `proxyType?: string`
  - `status?: string` (commonly `idle` / `running`)
  - `mode?: string` (`proxy` or `direct`, derived from `proxy`)
  - `using: boolean`
  - `type?: string`
  - `testIp: boolean`
  - `userAgent?: string`
  - `listId?: Id<"lists">`
  - `sessionsToday: number`
  - `lastOpenedAt?: number`
  - `uaOs?: string`, `uaBrowser?: string`
  - `login: boolean`
- Indexes:
  - `by_listId (listId)`
  - `by_name (name)`
  - `by_status (status)`

### `instagramAccounts`

- Fields:
  - `userName: string` (stored normalized)
  - `createdAt: number`
  - `assignedTo?: Id<"profiles">`
  - `status?: string`
  - `linkSent?: string`
  - `message: boolean`
  - `subscribedAt?: number`
  - `lastMessageSentAt?: number`
- Indexes:
  - `by_userName (userName)`
  - `by_assignedTo (assignedTo)`
  - `by_status (status)`
  - `by_assignedTo_status (assignedTo, status)`

### `instagramSettings`

- Fields: `scope: string`, `data: any`, `createdAt: number`, `updatedAt: number`
- Indexes: `by_scope (scope)`

### `messageTemplates`

- Fields: `kind: string`, `texts: string[]`, `createdAt: number`, `updatedAt: number`
- Indexes: `by_kind (kind)`

## Convex functions

This section documents the main public functions (queries/mutations) by module. Names match the exports in each file.

### `lists.ts`

- `list` (query): return all lists sorted by `createdAt`
- `create` (mutation): create a list (`name` required)
- `update` (mutation): rename a list (`id`, `name` required)
- `remove` (mutation): delete list and unassign `profiles.listId` referencing it

### `profiles.ts`

- `list` (query): return all profiles sorted by `createdAt`
- `getByName` (query): find a profile by exact `name` (trimmed)
- `getById` (query): fetch profile by document id
- `getAvailableForLists` (query): filter profiles by:
  - `listId` must be in `listIds`
  - `sessionsToday < maxSessions`
  - `lastOpenedAt` older than a `cooldownMinutes` window (or missing)
- `getByListIds` (query): all profiles whose `listId` is in `listIds`
- `create` (mutation): create profile with default fields (`status: "idle"`, `using: false`, `sessionsToday: 0`, `login: false`)
- `updateByName` / `updateById` (mutation): update name/proxy/UA fields; `mode` is re-derived from `proxy`
- `removeByName` / `removeById` (mutation): delete profile and unassign `instagramAccounts.assignedTo`
- `syncStatus` (mutation): set `status` and `using`; if status is `running`, sets `lastOpenedAt = now`
- `setLoginTrue` (mutation): sets `login: true` by profile name
- `listAssigned` (query): for a `listId`, returns logged-in profiles mapped to `{ profileId, name }`
- `listUnassigned` (query): returns logged-in profiles with no `listId`
- `bulkSetListId` (mutation): set/unset `listId` for multiple profile ids (use `null` to unassign)
- `clearBusyForLists` (mutation): for given list ids, sets busy profiles to `status: "idle", using: false`
- `incrementSessionsToday` (mutation): increments `sessionsToday` by 1 by profile name

Internal-only:

- `resetSessionsToday` (internal mutation): resets all profiles’ `sessionsToday` to 0

### `instagramAccounts.ts`

- `insert` (mutation): insert one account; normalizes `userName`; de-duplicates by `userName`
- `insertBatch` (mutation): insert many accounts; de-duplicates in-batch and against DB
- `getForProfile` (query): list accounts for a profile and exact `status` (default: `assigned`)
- `getToMessage` (query): list accounts for a profile where:
  - `message === true`
  - `linkSent` is `not send` or `needed to send`
- `updateStatus` (mutation): update `status` and optionally `assignedTo`
  - sets `subscribedAt = now` when `status` becomes `subscribed`
  - clears `assignedTo` when `status` becomes `done` (unless caller explicitly provides `assignedTo`)
- `updateMessage` (mutation): set `message` for a `userName`
- `updateLinkSent` (mutation): set `linkSent` for a `userName`
- `setLastMessageSentNow` (mutation): sets `lastMessageSentAt = now` by account id
- `getLastMessageSentAt` (query): return `lastMessageSentAt` by account id
- `listUserNames` (query): returns normalized usernames, sorted by `createdAt`, capped by `limit` (max 10,000)
- `getProfilesWithAssignedAccounts` (query): returns profiles referenced by `assignedTo` (optionally filtered by account status)

Internal-only automation:

- `_autoUnsubscribeApply` (internal mutation): sets `status = "unsubscribed"` for accounts subscribed ≥ 7 days ago
- `autoUnsubscribe` (internal action): runs `_autoUnsubscribeApply` with a 7-day cutoff
- `assignAvailableAccountsDaily` (internal action): per profile that has a `listId`, tops up `assigned` accounts to ~30–40

### `instagramSettings.ts`

- `get` (query): read settings object for `scope` (default: `global`)
- `upsert` (mutation): write settings object for `scope` (default: `global`)

### `messageTemplates.ts`

- `get` (query): read template texts for `kind` (returns `[]` if missing)
- `upsert` (mutation): write template texts for `kind` (trims out blank strings)

### `dashboard.ts`

- `getStats` (query): returns counts for profiles/lists/accounts and recent activity entries

## HTTP API (`http.ts`)

Convex HTTP Actions expose a JSON API under `/api/*`.

### Base URL

Requests are served from your deployment’s HTTP Actions domain:

- `https://<deployment>.convex.site/api/...`

### CORS

All `/api/*` routes are CORS-enabled with:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`

### Errors

- Auth failures return `401` with `{ "error": "Unauthorized" }`
- Handler failures generally return `400` with `{ "error": "..." }`

### Response shape notes

Some responses intentionally map fields to “Python-style” keys:

- Profiles use keys like `profile_id`, `created_at` (ISO), `proxy_type`, `sessions_today`.
- The `using` boolean is returned as `Using` (capital U).
- Instagram accounts use keys like `user_name`, `link_sent`, `subscribed_at`.

### Endpoints

#### Profiles

- `GET /api/profiles`
  - Response: `DbProfileRow[]` (mapped)
- `GET /api/profiles/by-name?name=<name>`
  - Response: `DbProfileRow | null`
- `GET /api/profiles/by-id?profileId=<id>` (also accepts `profile_id`)
  - Response: `DbProfileRow | null`
- `POST /api/profiles`
  - Body: `{ name, proxy?, proxyType?|proxy_type?, type?, testIp?|test_ip?, userAgent?|user_agent?, uaOs?|ua_os?, uaBrowser?|ua_browser? }`
  - Response: `DbProfileRow | null`
- `POST /api/profiles/update-by-name`
  - Body: `{ oldName, name, proxy?, proxyType?, type?, testIp?, userAgent?, uaOs?, uaBrowser? }`
  - Response: `DbProfileRow | null`
- `POST /api/profiles/update-by-id`
  - Body: `{ profileId|profile_id, name, proxy?, proxyType?|proxy_type?, type?, testIp?|test_ip?, userAgent?|user_agent?, uaOs?|ua_os?, uaBrowser?|ua_browser? }`
  - Response: `DbProfileRow | null`
- `POST /api/profiles/delete-by-id`
  - Body: `{ profileId|profile_id }`
  - Response: `{ ok: true }`
- `POST /api/profiles/remove-by-name` (alias: `POST /api/profiles/delete-by-name`)
  - Body: `{ name }`
  - Response: `{ ok: true }`
- `POST /api/profiles/sync-status`
  - Body: `{ name, status, using? }`
  - Response: `{ ok: true }`
- `POST /api/profiles/set-login-true`
  - Body: `{ name }`
  - Response: `{ ok: true }`
- `POST /api/profiles/increment-sessions-today`
  - Body: `{ name }`
  - Response: `{ ok: true }`
- `POST /api/profiles/available`
  - Body: `{ listIds|list_ids: string[], maxSessions|max_sessions: number, cooldownMinutes|cooldown_minutes: number }`
  - Response: `DbProfileRow[]`
- `POST /api/profiles/by-list-ids`
  - Body: `{ listIds|list_ids: string[] }`
  - Response: `DbProfileRow[]`
- `GET /api/profiles/assigned?list_id=<listId>`
  - Response: `{ profile_id, name }[]`
- `GET /api/profiles/unassigned`
  - Response: `{ profile_id, name }[]`
- `POST /api/profiles/bulk-set-list-id`
  - Body: `{ profileIds|profile_ids: string[], listId|list_id: string | null }`
  - Response: `{ ok: true }`
- `POST /api/profiles/clear-busy-for-lists`
  - Body: `{ listIds|list_ids: string[] }`
  - Response: `{ ok: true }`

#### Lists

- `GET /api/lists`
  - Response: `{ id, name }[]`
- `POST /api/lists`
  - Body: `{ name }`
  - Response: `{ id, name } | null`
- `POST /api/lists/update`
  - Body: `{ id, name }`
  - Response: `{ id, name } | null`
- `POST /api/lists/remove` (alias: `POST /api/lists/delete`)
  - Body: `{ id }`
  - Response: `{ ok: true }`

#### Instagram settings

- `GET /api/instagram-settings?scope=<scope>`
  - Response: `Record<string, any> | null`
- `POST /api/instagram-settings`
  - Body: `{ scope?, data }`
  - Response: `Record<string, any> | null`

#### Message templates

- `GET /api/message-templates?kind=<kind>`
  - Response: `string[]`
- `POST /api/message-templates`
  - Body: `{ kind, texts: string[] }`
  - Response: `{ ok: true }`

#### Instagram accounts

- `GET /api/instagram-accounts/for-profile?profileId=<id>&status=<status>`
  - Response: account rows (mapped)
- `GET /api/instagram-accounts/to-message?profileId=<id>`
  - Response: account rows (mapped)
- `POST /api/instagram-accounts/update-status`
  - Body: `{ accountId|account_id|id, status, assignedTo?|assigned_to? }`
  - Response: account row (mapped)
- `POST /api/instagram-accounts/update-message`
  - Body: `{ userName|user_name, message? }`
  - Response: account row (mapped) or `null`
- `POST /api/instagram-accounts/update-link-sent`
  - Body: `{ userName|user_name, linkSent|link_sent }`
  - Response: account row (mapped) or `null`
- `POST /api/instagram-accounts/set-last-message-sent-now`
  - Body: `{ accountId|account_id|id }`
  - Response: account row (mapped)
- `GET /api/instagram-accounts/last-message-sent-at?accountId=<id>` (also accepts `account_id` or `id`)
  - Response: ISO datetime string or `null`
- `GET /api/instagram-accounts/usernames?limit=<n>`
  - Response: `string[]`
- `GET /api/instagram-accounts/profiles-with-assigned?status=<status>`
  - Response: `DbProfileRow[]`

### Example curl

```bash
curl -sS \
  -H "Authorization: Bearer $CONVEX_API_KEY" \
  "https://<deployment>.convex.site/api/profiles"
```

```bash
curl -sS \
  -H "Authorization: Bearer $CONVEX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Profile 1","proxy_type":"http"}' \
  "https://<deployment>.convex.site/api/profiles"
```

## Cron jobs (`crons.ts`)

Daily schedules (UTC):

- `00:00` — reset `profiles.sessionsToday`
- `03:00` — auto-unsubscribe accounts subscribed ≥ 7 days
- `03:15` — top up assigned accounts for profiles with `listId`

