# Supabase to Convex Migration Plan

Complete migration plan to move from Supabase PostgreSQL to Convex database backend.  
**Python Client Strategy**: Use Convex HTTP API directly (no Node.js bridge, no Supabase hybrid).

---

## Verified Supabase Files

### TypeScript / TUI (10 files)

| File | Purpose | Migration Action |
|------|---------|------------------|
| [supabase.ts](file:///c:/Users/yaros/Downloads/anti/source/lib/supabase.ts) | Core client + all DB calls | Replace entirely with Convex client |
| [profiles.ts](file:///c:/Users/yaros/Downloads/anti/source/lib/profiles.ts) | Profile CRUD/status wrapper | Update imports to Convex |
| [listsService.ts](file:///c:/Users/yaros/Downloads/anti/source/lib/listsService.ts) | Lists refresh | Update imports to Convex |
| [messagesService.ts](file:///c:/Users/yaros/Downloads/anti/source/lib/messagesService.ts) | Message templates fetch/save | Update imports to Convex |
| [Login.tsx](file:///c:/Users/yaros/Downloads/anti/source/components/Login.tsx) | Marks profile as logged-in | Update [profilesSetLoginTrue](file:///c:/Users/yaros/Downloads/anti/source/lib/supabase.ts#199-215) call |
| [profiles/index.tsx](file:///c:/Users/yaros/Downloads/anti/source/components/profiles/index.tsx) | Marks profile as logged-in | Update [profilesSetLoginTrue](file:///c:/Users/yaros/Downloads/anti/source/lib/supabase.ts#199-215) call |
| [instagram/index.tsx](file:///c:/Users/yaros/Downloads/anti/source/components/instagram/index.tsx) | Clears busy profiles | Update [profilesClearBusyForLists](file:///c:/Users/yaros/Downloads/anti/source/lib/supabase.ts#253-278) call |
| [useLists.ts](file:///c:/Users/yaros/Downloads/anti/source/components/lists/hooks/useLists.ts) | Lists + profile assignment | Update all list/profile calls |
| [useInstagramSettings.ts](file:///c:/Users/yaros/Downloads/anti/source/components/instagram/hooks/useInstagramSettings.ts) | Settings load/save | Update settings calls |
| [useLists.test.ts](file:///c:/Users/yaros/Downloads/anti/source/tests/useLists.test.ts) | Test file (mock) | Update mock to Convex |

---

### Python Runtime (11 files)

| File | Purpose | Migration Action |
|------|---------|------------------|
| [config.py](file:///c:/Users/yaros/Downloads/anti/python/supabase/config.py) | Env config for keys/URL | Replace with Convex config |
| [shared_session.py](file:///c:/Users/yaros/Downloads/anti/python/supabase/shared_session.py) | HTTP session pooling | Keep (works with any HTTP) |
| [__init__.py](file:///c:/Users/yaros/Downloads/anti/python/supabase/__init__.py) | Package exports | Update exports |
| [client.py](file:///c:/Users/yaros/Downloads/anti/python/supabase/client.py) | Fetch usernames via REST | Replace with Convex HTTP |
| [profiles_client.py](file:///c:/Users/yaros/Downloads/anti/python/supabase/profiles_client.py) | Profiles CRUD via REST | Replace with Convex HTTP actions |
| [instagram_accounts_client.py](file:///c:/Users/yaros/Downloads/anti/python/supabase/instagram_accounts_client.py) | Accounts + busy checks | Replace with Convex HTTP actions |
| [instagram_settings_client.py](file:///c:/Users/yaros/Downloads/anti/python/supabase/instagram_settings_client.py) | Settings access | Replace with Convex HTTP actions |
| [message_templates_client.py](file:///c:/Users/yaros/Downloads/anti/python/supabase/message_templates_client.py) | Templates access | Replace with Convex HTTP actions |
| [profile_manager.py](file:///c:/Users/yaros/Downloads/anti/python/core/persistence/profile_manager.py) | Syncs local→DB | Update import from Convex client |
| [messaging/session.py](file:///c:/Users/yaros/Downloads/anti/python/automation/messaging/session.py) | Instantiates accounts client | Update import |
| [messaging/templates.py](file:///c:/Users/yaros/Downloads/anti/python/automation/messaging/templates.py) | Templates fallback | Update import |
| [approvefollow/session.py](file:///c:/Users/yaros/Downloads/anti/python/automation/approvefollow/session.py) | Instantiates accounts client | Update import |

---

### Python Tests (3 files)

| File | Action |
|------|--------|
| [test_executor_lifecycle.py](file:///c:/Users/yaros/Downloads/anti/python/tests/test_executor_lifecycle.py) | Update mocks for Convex |
| [test_profile_caching.py](file:///c:/Users/yaros/Downloads/anti/python/tests/test_profile_caching.py) | Update mocks for Convex |
| [test_shared_session.py](file:///c:/Users/yaros/Downloads/anti/python/tests/test_shared_session.py) | Update mocks for Convex |

---

### Docs / Config (4 files)

| File | Action |
|------|--------|
| [README.md](file:///c:/Users/yaros/Downloads/anti/README.md) | Replace Supabase setup with Convex |
| [DEPLOY.md](file:///c:/Users/yaros/Downloads/anti/DEPLOY.md) | Update .env vars documentation |
| [docker-compose.yml](file:///c:/Users/yaros/Downloads/anti/docker-compose.yml) | No change (reads .env generically) |
| [package.json](file:///c:/Users/yaros/Downloads/anti/package.json) | Remove `@supabase/supabase-js`, add `convex` |

---

### Database Schema (DELETE after migration)

| File | Action |
|------|--------|
| [202512210001_initial_schema.sql](file:///c:/Users/yaros/Downloads/anti/supabase/migrations/202512210001_initial_schema.sql) | DELETE |
| [seed.sql](file:///c:/Users/yaros/Downloads/anti/python/supabase/seed.sql) | DELETE |
| [supabase/.gitignore](file:///c:/Users/yaros/Downloads/anti/supabase/.gitignore) | DELETE entire `supabase/` folder |

---

## Phase 1: Convex Project Setup

### [NEW] convex/schema.ts
```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  lists: defineTable({
    name: v.string(),
    createdAt: v.number(),
  }),

  profiles: defineTable({
    name: v.string(),
    proxy: v.optional(v.string()),
    proxyType: v.optional(v.string()),
    status: v.optional(v.string()),
    mode: v.optional(v.string()),
    using: v.boolean(),
    type: v.optional(v.string()),
    testIp: v.boolean(),
    userAgent: v.optional(v.string()),
    listId: v.optional(v.id("lists")),
    sessionsToday: v.number(),
    lastOpenedAt: v.optional(v.number()),
    uaOs: v.optional(v.string()),
    uaBrowser: v.optional(v.string()),
    login: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_listId", ["listId"])
    .index("by_name", ["name"])
    .index("by_status", ["status"]),

  instagramAccounts: defineTable({
    userName: v.string(),
    assignedTo: v.optional(v.id("profiles")),
    status: v.optional(v.string()),
    linkSent: v.optional(v.string()),
    message: v.boolean(),
    subscribedAt: v.optional(v.number()),
    lastMessageSentAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_assignedTo", ["assignedTo"])
    .index("by_status", ["status"])
    .index("by_assignedTo_status", ["assignedTo", "status"]),

  instagramSettings: defineTable({
    scope: v.string(),
    data: v.any(),
    updatedAt: v.number(),
    createdAt: v.number(),
  }).index("by_scope", ["scope"]),

  messageTemplates: defineTable({
    kind: v.string(),
    texts: v.array(v.string()),
    updatedAt: v.number(),
    createdAt: v.number(),
  }).index("by_kind", ["kind"]),
});
```

---

## Phase 2: Convex Functions

### New Files to Create

| File | Functions |
|------|-----------|
| `convex/lists.ts` | [list](file:///c:/Users/yaros/Downloads/anti/source/lib/supabase.ts#46-52), [create](file:///c:/Users/yaros/Downloads/anti/python/supabase/profiles_client.py#108-127), [update](file:///c:/Users/yaros/Downloads/anti/python/supabase/profiles_client.py#128-145), `remove` |
| `convex/profiles.ts` | [list](file:///c:/Users/yaros/Downloads/anti/source/lib/supabase.ts#46-52), `getByName`, [create](file:///c:/Users/yaros/Downloads/anti/python/supabase/profiles_client.py#108-127), `updateByName`, `removeByName`, `syncStatus`, `setLoginTrue`, `listAssigned`, `listUnassigned`, `bulkSetListId`, `clearBusyForLists`, `incrementSessionsToday`, `resetSessionsToday` |
| `convex/instagramAccounts.ts` | `getForProfile`, `getToMessage`, `updateStatus`, `updateMessage`, `updateLinkSent`, `setLastMessageSentNow`, `getProfilesWithAssignedAccounts`, `autoUnsubscribe`, `assignAvailableAccountsDaily` |
| `convex/instagramSettings.ts` | [get](file:///c:/Users/yaros/Downloads/anti/python/supabase/message_templates_client.py#39-47), [upsert](file:///c:/Users/yaros/Downloads/anti/python/supabase/message_templates_client.py#48-56) |
| `convex/messageTemplates.ts` | [get](file:///c:/Users/yaros/Downloads/anti/python/supabase/message_templates_client.py#39-47), [upsert](file:///c:/Users/yaros/Downloads/anti/python/supabase/message_templates_client.py#48-56) |
| `convex/http.ts` | HTTP endpoints for Python clients |
| `convex/crons.ts` | Scheduled jobs |

---

## Phase 3: Cron Jobs Migration

```typescript
// convex/crons.ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Daily at midnight UTC - reset sessions_today
crons.daily("reset sessions today", { hourUTC: 0, minuteUTC: 0 }, 
  internal.profiles.resetSessionsToday);

// Daily at 3:00 AM UTC - auto unsubscribe after 7 days
crons.daily("auto unsubscribe", { hourUTC: 3, minuteUTC: 0 }, 
  internal.instagramAccounts.autoUnsubscribe);

// Daily at 3:15 AM UTC - assign 30-40 accounts per profile
crons.daily("assign accounts", { hourUTC: 3, minuteUTC: 15 }, 
  internal.instagramAccounts.assignAvailableAccountsDaily);

export default crons;
```

---

## Phase 4: Python HTTP Client Strategy

Python clients will call Convex HTTP actions:

### [NEW] convex/http.ts
```typescript
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";

const http = httpRouter();

// Example: GET /api/profiles
http.route({
  path: "/api/profiles",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const profiles = await ctx.runQuery(api.profiles.list);
    return new Response(JSON.stringify(profiles), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// ... similar routes for all Python client operations

export default http;
```

### Python Client Changes

```python
# Before (Supabase)
self.base_url = f"{PROJECT_URL}/rest/v1/profiles"
resp = self.http_client.get(url, headers={"apikey": SECRET_KEY}, ...)

# After (Convex)
self.base_url = f"{CONVEX_URL}/api/profiles"
resp = self.http_client.get(url, headers={"Authorization": f"Bearer {CONVEX_API_KEY}"}, ...)
```

---

## Phase 5: Field Name Transformations

| Supabase (snake_case) | Convex (camelCase) |
|----------------------|-------------------|
| [profile_id](file:///c:/Users/yaros/Downloads/anti/python/supabase/instagram_accounts_client.py#241-267) | [_id](file:///c:/Users/yaros/Downloads/anti/python/supabase/instagram_accounts_client.py#241-267) (auto) |
| `created_at` | `createdAt` |
| `proxy_type` | `proxyType` |
| `test_ip` | `testIp` |
| `user_agent` | `userAgent` |
| `list_id` | `listId` |
| [sessions_today](file:///c:/Users/yaros/Downloads/anti/python/supabase/profiles_client.py#93-107) | `sessionsToday` |
| `last_opened_at` | `lastOpenedAt` |
| `ua_os` | `uaOs` |
| `ua_browser` | `uaBrowser` |
| `Using` | `using` |
| `user_name` | `userName` |
| `assigned_to` | `assignedTo` |
| [link_sent](file:///c:/Users/yaros/Downloads/anti/python/supabase/instagram_accounts_client.py#180-191) | `linkSent` |
| `subscribed_at` | `subscribedAt` |
| [last_message_sent_at](file:///c:/Users/yaros/Downloads/anti/python/supabase/instagram_accounts_client.py#119-132) | `lastMessageSentAt` |
| `updated_at` | `updatedAt` |

---

## Phase 6: Data Migration Script

### [NEW] scripts/migrate_supabase_to_convex.ts

**Migration Order** (respecting foreign keys):
1. [lists](file:///c:/Users/yaros/Downloads/anti/source/lib/supabase.ts#46-52) → [lists](file:///c:/Users/yaros/Downloads/anti/source/lib/supabase.ts#46-52)
2. `instagram_settings` → [instagramSettings](file:///c:/Users/yaros/Downloads/anti/source/lib/supabase.ts#279-287)
3. `message_templates` → [messageTemplates](file:///c:/Users/yaros/Downloads/anti/source/lib/supabase.ts#303-313)
4. [profiles](file:///c:/Users/yaros/Downloads/anti/source/lib/supabase.ts#81-87) → [profiles](file:///c:/Users/yaros/Downloads/anti/source/lib/supabase.ts#81-87) (map `list_id` → `listId` using ID mapping)
5. `instagram_accounts` → `instagramAccounts` (map `assigned_to` → `assignedTo`)

---

## Phase 7: Environment Config

### [MODIFY] .env
```diff
- SUPABASE_URL=https://xxx.supabase.co
- SUPABASE_SECRET_KEY=xxx
- SUPABASE_PUBLISHABLE_KEY=xxx
+ CONVEX_URL=https://xxx.convex.cloud
+ CONVEX_DEPLOY_KEY=xxx
```

---

## Verification Plan

### Pre-Migration
- [ ] Export all Supabase data as JSON backup
- [ ] Record row counts per table

### Post-Migration
- [ ] Verify matching row counts in Convex
- [ ] Sample 10 records from each table, compare values
- [ ] Test all TypeScript functions via TUI
- [ ] Test all Python HTTP calls
- [ ] Trigger cron jobs manually in Convex dashboard

---

## Summary: Files to Change

| Category | Count | Files |
|----------|-------|-------|
| TypeScript Replace | 1 | supabase.ts → convex.ts |
| TypeScript Update | 9 | profiles.ts, listsService.ts, messagesService.ts, Login.tsx, profiles/index.tsx, instagram/index.tsx, useLists.ts, useInstagramSettings.ts, useLists.test.ts |
| Python Replace | 5 | config.py, client.py, profiles_client.py, instagram_accounts_client.py, instagram_settings_client.py, message_templates_client.py |
| Python Update | 4 | __init__.py, profile_manager.py, messaging/session.py, messaging/templates.py, approvefollow/session.py |
| Python Tests | 3 | test_executor_lifecycle.py, test_profile_caching.py, test_shared_session.py |
| New Convex | 7 | schema.ts, lists.ts, profiles.ts, instagramAccounts.ts, instagramSettings.ts, messageTemplates.ts, http.ts, crons.ts |
| Docs | 2 | README.md, DEPLOY.md |
| Delete | 3+ | supabase/ folder, seed.sql |
