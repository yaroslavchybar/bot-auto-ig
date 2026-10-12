# Daily IG routines

Create one automation per model. Select browsing surfaces, daily time, and session/rest ranges, then optionally enable Outreach. Outreach starts on warm-up day 8 once the account has at least three posts and its mobile login is connected. Posting continues daily to the configured target without blocking outreach.

Warm-up days 1–7 gradually engage topic-related accounts. Maintenance mixes browsing with lead outreach. Each new follow is separated by browsing. The daily follow target starts small, grows after confirmed outreach days, and stays within the configured maximum. Paused profiles do not run.

## Lead screening

Choose a scraped list, participating profiles, message, and allowed lead categories in Outreach. Male is the default; female and business can be selected independently. At least one category must be selected.

The scraper saves deduplicated likers as pending leads. There is no background enrichment. During outreach, the worker leases a candidate, opens its Instagram profile, waits for the correct profile header, takes a viewport screenshot, and sends it to openai/gpt-6-luna-decisions through the existing OpenRouter key. Screenshots stay in memory and are not persisted or logged.

Business accounts take priority. Male/female labels require explicit public self-description in the target profile text; names, pronouns alone, and appearance cannot establish gender. Insufficient evidence or confidence below 80% becomes unclear and is skipped. Classification, confidence, model, and time are saved in the lead table. The Leads view shows when screening occurred.

A matching category receives a permanent sender assignment and one daily follow slot. Excluded categories and unclear results do not consume quota. A known excluded category is not repeatedly opened by the same category policy; another eligible automation can screen it. Provider failures preserve any saved decision, retry after five then ten minutes, and stop automatic screening after three consecutive failures. A successful decision resets the failure count; explicitly retrying failed enrichment also resets it. A two-minute lease expires after a crashed or interrupted worker. Stale results cannot overwrite a newer lease. Approval rechecks pause, list membership, category settings, day, and daily allowance.

The existing lead pool has been reset for browser screening. Assignments and outreach history are preserved. Retired lead picture fields are removed; Chat avatar URLs are independent and retained. Worker metadata and proxy assignments are maintained by ordinary writes, with no migration jobs or startup backfills.

## Outreach and cleanup

An accepted recipient is followed if it is not already followed or requested. Confirmed follows are recorded for cleanup; public accounts may receive one like. Only confirmed follows advance the follow ramp. Approved claims remain permanent after an interrupted Instagram action, avoiding duplicate outreach.

Notifications are checked daily. DMs begin on the next day only after a confirmed follow-back, using the message from the selected scraped list. Category settings are rechecked before Send. Message variations and placeholders are rendered once. An uncertain delivery stops that profile for review; it is never blindly resent.

Confirmed follows or requests are removed after the configured unfollow delay. Cleanup runs in the same automation sessions and preserves sender history. Browsing, screening, follows, DMs, pauses, and cleanup share the session deadline. Rest releases the browser slot.

Deploy matching Convex, server, and frontend changes together. No new manual login or API key is needed.
