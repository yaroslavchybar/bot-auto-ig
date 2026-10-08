# Chat storage and synchronization

Messages travel from Instagram through the authenticated Rust/Axum API to the device.
Instagram credentials and account proxies stay on the server.

- IndexedDB shows the last inbox and recent messages immediately. It stores at
  most 100 conversations per user, 30 recent messages per conversation, and
  pending sends for 24 hours. Cached conversations expire after 30 days.
- A SQLite file at `data/chat-cache/cache.sqlite` shares fetched messages between
  devices and survives server restarts. Rust owns this file and runs storage work
  outside the async executor. SQLite uses WAL, a 2 MiB page-cache budget, and at most 200
  conversations per profile with 30 recent messages each. Media bytes are not
  stored here. Unsent-message tombstones are bounded to 100 IDs per conversation.
- Convex keeps the login session file, connection membership, and one small
  unread counter per profile. Chat histories and previews are no longer read or
  written there. The sidebar counter has no dependency on profile cookies or
  login-session checkpoints.

The Chat profile selector fetches only eligible profile IDs, names, and status,
without browser configuration or cookie payloads.

Contact pictures in the inbox and conversation header are cached as image blobs
in the device's IndexedDB, with up to 200 pictures per user for 30 days. Opening
Chat reuses pictures fetched within the last 24 hours and refreshes older ones.
There is no picture refresh timer. The cached picture stays visible during refresh
and when offline; failed refreshes do not reset its age. Rust refreshes inbox picture
URLs daily, including quiet contacts, and forwards small thumbnails from
Instagram through the account proxy; it does not store picture bytes on the server.
Only visible avatars load pictures. Missing pictures and group chats show initials.

## Chat archives and filters

Use **Archive** in a conversation header to move it out of the default **Inbox**.
Choose **Archived** to view archived conversations, or **Inbox** for active chats.
Use **Move to inbox** to restore a chat. New messages leave archived chats archived.
You can also right-click a conversation in the list to archive it or move it to Inbox.
Archiving does not delete messages or change Instagram's inbox.

Folder filters combine with the profile selector and search, and stay in the URL.
Archive status belongs to a profile/conversation pair, so identical thread IDs in
other profiles remain independent. The open conversation and draft stay available
when it is archived, even though it disappears from the Inbox list.

Convex stores durable archive records in `chatArchives`, separate from message
caches. Internal functions and the authenticated Rust API use a server-only
Convex HTTP bridge key. Socket notifications refresh archive status on other devices.
Archive status survives cache eviction, logout, and reconnect. Deleting a profile
removes its archive records.

The shared inbox and open conversation have 60-second and 20-second server
freshness windows, respectively. In-flight Instagram requests are shared and
failures back off for two minutes. The server keeps at most 32 profile entries,
each with an inbox snapshot and up to 100 conversation freshness markers.
Conversation histories live in SQLite. Background inbox checks run every
15 minutes, also when no device is open, and skip unchanged writes.

Rust keeps saved Instagram sessions in memory for at most 32 profiles. A
server-authenticated Convex subscription supplies only session file revisions,
connection tokens, reconnect flags, eligibility, and proxies. Unchanged sessions
need no periodic Convex HTTP reads. New sessions and changed revisions reload
the private session file; proxy changes take effect without downloading it.
Only changed cookies or unread counts are written back. Subscription outages
disable reuse and fall back to authenticated HTTP reads. Reconnection uses a
fresh subscription before allowing cached sessions again. The 15-minute sync
continues even when Chat is closed.

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
the format change does not require login. Message caching, synchronization, send
handlers, background checks, and chat socket events are owned by Rust. Successful
sends return before background refresh; refresh failures do not turn a sent message
into a failed send.

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

Native regression tests cover durable cache/session isolation, bounded history,
unchanged-write suppression, transactions, reply watermarks, cross-profile unsend,
stale-preview reconciliation, disconnected throttling, and successful sends during
refresh failures. The shared Convex connection is exercised against a local protocol
fixture. No deployment or production cleanup was performed for the Rust migration.

The checks below describe the earlier browser-cache rollout:

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
[rusqlite](https://docs.rs/rusqlite/latest/rusqlite/),
[Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API),
[BroadcastChannel](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API),
[browser storage eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
