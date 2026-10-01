# Chat storage and synchronization

Messages travel from Instagram through the authenticated Rust/Axum API to the device.
Instagram credentials and account proxies stay on the server.

- IndexedDB shows the last inbox and recent messages immediately. It stores at
  most 100 conversations per user, 30 recent messages per conversation, and
  pending sends for 24 hours. Cached conversations expire after 30 days.
- A SQLite file at `data/chat-cache/cache.sqlite` shares fetched messages between
  devices and survives server restarts. The existing Docker data mount covers
  this directory. SQLite uses WAL, a 2 MiB page-cache budget, and at most 200
  conversations per profile with 30 recent messages each. Media bytes are not
  stored here. Unsent-message tombstones are bounded to 100 IDs per conversation.
- Convex keeps the login session file, connection membership, and one small
  unread counter per profile. Chat histories and previews are no longer read or
  written there. The sidebar counter has no dependency on profile cookies or
  login-session checkpoints.

The Chat profile selector fetches only eligible profile IDs, names, and status,
without browser configuration or cookie payloads.

## Chat tags and filters

Open a conversation and use **Tags** to create a tag, reuse an existing one,
or remove a tag. Each chat supports up to 10 tags, with 40 characters per tag.
Names are trimmed, spaces collapsed, and stored in lowercase to avoid duplicates.

Use **All tags** above the conversation list to filter by tag. Combine it with
the profile selector and search. The tag and profile filters stay in the page URL.
Tags apply to a profile/conversation pair, so matching Instagram thread IDs in
different profiles remain independent.

Convex stores only the tag metadata in `chatTags`. Reads and writes use internal
functions behind the authenticated API and server-only Convex HTTP bridge key.
The sole app admin can access all existing profiles; deleting profiles are excluded.
Authenticated chat socket notifications refresh tags on other devices.
Tags survive cache eviction, logout, and reconnect. Deleting a profile removes its tags.

The shared inbox and open conversation have 60-second and 20-second server
freshness windows, respectively. In-flight Instagram requests are shared and
failures back off for two minutes. The server keeps at most 32 inbox snapshots
and 100 conversation snapshots in memory. Background inbox checks run every
15 minutes, also when no device is open, and skip unchanged writes.

Active browser pages poll the inbox every minute and the selected conversation
every 30 seconds. After a minute without keyboard or pointer activity, those
intervals slow to three minutes and two minutes. Hidden tabs stop polling and
close their chat socket. Small `chat_changed` socket notifications refresh other
devices; identical messages do not generate notifications.

Web Locks coordinate identical reads between tabs. A ten-second IndexedDB
response cache lets followers reuse the first tab's result; it holds at most 20
responses per user and removes expired responses on writes. BroadcastChannel
notifies other tabs using user/cache keys only. These APIs are optional: storage
restrictions leave direct network loading usable. Signing out clears local data.

Read receipts do not clear the app's unanswered-chat queue. Only confirmed
outgoing messages advance the reply watermark. History reconciliation preserves
newer concurrent inbox previews, reconciles confirmed IDs, and filters unsent
messages on both connected sides of a conversation. Replacing or disconnecting
a login session clears its server cache. Browser pending sends remain separate
until Instagram confirms them.

The custom Rust mobile client persists cookies (including session cookies),
authorization, and device identity in Convex when state changes. Operations share
a per-profile lock, and saves use the current connection token to prevent an old
client from restoring a disconnected session. Existing TypeScript SDK sessions
are imported into Rust with their cookies, authorization, and device identity;
the format change does not require login. Message caching remains in Bun/SQLite.

## Rollout

Deploy the matching Convex, server, and frontend changes together. The first
background check repopulates SQLite from Instagram; no browser device is needed
to recover cached messages. Counts are bounded by the 200-conversation server
cache, rather than unlimited history. SQLite is local to one VPS: a different
VPS starts with an empty message cache and uses the durable login sessions.

After the old server has stopped writing message caches, run each command until
the result says `isDone: true` (each call removes up to 25 documents and bounds
bytes read):

```sh
bunx convex run chatCache:retireHistory '{"table":"chatThreads"}' --prod --codegen disable
bunx convex run chatCache:retireHistory '{"table":"chatHistories"}' --prod --codegen disable
```

This cleanup removes disposable cached histories, not login sessions or the
Instagram messages themselves. The old optional cache fields in `chatSessions`
remain schema-compatible with existing rows but have no runtime readers.

No deployment or production cleanup was performed during implementation.

## Validation

Type checks, lint, both builds, 276 server tests, 128 Convex tests, and 33 UI tests
passed. Two existing browser integration tests were skipped. A real Chrome check
also verified cross-tab deduplication, IndexedDB persistence, user isolation,
cancellation, response invalidation, and the 20-response storage bound:

```sh
bun tools/verification/chat-cache.smoke.ts
```

These checks verify behavior locally. Production savings must be measured after
deployment; the implementation did not change production usage or data.

References: [Convex best practices](https://docs.convex.dev/understanding/best-practices),
[Bun SQLite](https://bun.com/docs/runtime/sqlite),
[Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API),
[BroadcastChannel](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API),
[browser storage eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
