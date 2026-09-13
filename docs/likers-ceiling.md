# Instagram likers scrape ceiling (~100 per post)

Date: 2026-09-13. Question: why do scrape jobs stop at ~98 likers on posts
with 175+ likes, with no pagination cursor?

## Answer

Instagram caps liker lists at ~100 users on every web-session path. There is
no cursor to follow — it is a server-side limit, not a client bug.

## Evidence

- `GET www.instagram.com/api/v1/media/{id}/likers/?count=N` returns one page
  of up to ~100 users and **no `next_max_id`**. `count` only shrinks the
  single window (verified: `count=25` → 25 users, no cursor; no count →
  98 users, no cursor). Quota commits show exactly one page fetched.
- `POST www.instagram.com/api/graphql` with doc_id `24452425501069647`
  (`xdt_api__v1__likes__media_id__likers`, the instagrapi
  `media_likers_gql` path) returns 97 users, payload keys `['users']` only —
  no cursor, no total. Tested live in devtools on post `DV9MDsHDYJ7`
  (pk `3854289886178542203`): `after` / `max_id` / `end_cursor` / `cursor`
  params all return the same 97 users.
- instagrapi itself never paginates likers: `media_likers()` is one mobile
  call with no loop, `media_likers_gql()` fetches a single chunk
  (`instagrapi/mixins/media.py`).
- Public reports agree: Instaloader maintainers ("that has no pagination so
  your results are limited" to ~100, issues #2175 / #2205),
  `ping/instagram_private_api` #199 (missing `next_max_id`), old Stack
  Overflow threads (likes endpoint stopped paginating; ~120 max back then).

## Our implementation (matches igscrape)

- `server/automation/igWebApi.ts` — `fetchMediaLikersPage`: fixed
  `count=100`, strict validation, numeric cursors. Transport is
  `page.evaluate` in the warmed-up browser session.
- `server/automation/scrape.ts` — port of igscrape `runRealScrape`: fetch
  page → filter → persist in chunks of 25 → pause 3–10s; 3 attempts per
  page; resume skips already-saved rows; empty-page-with-cursor and
  repeated-cursor are hard errors.
- `server/scrapeJobs/` + Convex `scrapeJobs` / `instagramAccounts` tables.
  Same ceiling as the Go `igscrape` service — it calls the same endpoint.

## Options for more than ~100

1. **Accept the cap, show honest coverage.** The REST response includes
   `user_count` (the true total). Display "97 of 175" per job. Cheap, safe.
2. **GraphQL doc_id path** — tested, same ~100 cap, no pagination. Dead end
   unless Instagram ships a new paginated query.
3. **Mobile API emulation** (instagrapi-style: app headers, signed bodies,
   device IDs against `i.instagram.com`). Single call returns more (~1k per
   user reports) but still no full pagination — and it means a second auth
   stack beside the Camoufox sessions, signature upkeep, and detection risk
   from accounts acting as browser + fake app at once.

## Recommendation

Option 1 unless full liker lists from big posts are required. Option 3 only
if that need is proven — it is real work with account risk attached.
