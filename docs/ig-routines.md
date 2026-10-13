# Daily IG routines

Create one automation per model. Select browsing surfaces, daily time, and session/rest ranges, then optionally enable Outreach. Outreach starts on warm-up day 8 once the account has at least three posts and its mobile login is connected. Posting continues daily to the configured target without blocking outreach.

Warm-up days 1–7 gradually engage topic-related accounts. Maintenance mixes browsing with lead outreach. Each new follow is separated by browsing. The daily follow target starts small, grows after confirmed outreach days, and stays within the configured maximum. Paused profiles do not run.

Topic post searches run only on warm-up days 1–4. The worker opens Search, types a generated hashtag, presses Enter, and clicks its exact native result. It scrolls the grid, opens visible posts, and closes each post before continuing. From day 5, browsing uses the enabled Home feed/Reels surfaces with the same screenshot topic rule. Week-one topic account searches for likes/follows continue through day 7.

Sidebar navigation works with both collapsed icons and expanded labels. Notification checks retry a changing control once, then skip the optional check if it stays unavailable. Temporary DOM visibility, detachment, and animation errors use the normal retry cooldown; saved errors of these kinds also recover. Login, checkpoint, and uncertain delivery issues still require attention.

Feed, profiles, overlays, and notification scanning use eased wheel scrolling. Controls are revealed inside their own scroll container before cursor movement and clicking, while staying bound to the selected element. Reels select the video with the largest visible area and advance only through the named Next button with cursor movement. Advancement succeeds only after the URL changes and the video settles into view. Explore opens a tile already near the viewport with a longer click budget; temporary search or Explore failures skip that phase and continue normal browsing. Week-one, standalone warm-up, and maintenance share bounded browsing retries. Story chunk expiry skips the optional story; completed views count before optional maintenance.

Visible automation sessions move the native desktop pointer along Cloak's mouse path before clicking. TigerVNC includes that remote cursor in the stream; no cursor is injected into the page. The viewer hides its local cursor while the agent controls the session. Manual sessions keep normal cursor control.

## Lead screening

Choose a scraped list, participating profiles, message, and allowed lead categories in Outreach. Male is the default; female and business can be selected independently. At least one category must be selected.

The scraper saves deduplicated likers as pending leads. There is no background enrichment. During outreach, the worker leases a candidate, opens its Instagram profile, waits for the correct profile header, takes a viewport screenshot, and sends it to openai/gpt-6-luna-decisions through the existing OpenRouter key. Screenshots stay in memory and are not persisted or logged.

Luna scores three categories from that screenshot alone: male, female, and business, using the username, full name, bio, profile picture and visible posts. The highest score wins, without a category confidence cutoff or priority override, and every decision gets a category. Classification, confidence, model, and time are saved in the lead table. The Leads view shows when screening occurred.

A matching category receives a permanent sender assignment and one daily follow slot. Excluded categories and failed screening do not consume quota. A known excluded category is not repeatedly opened by the same category policy; another eligible automation can screen it. Provider failures preserve any saved decision, retry after five then ten minutes, and stop automatic screening after three consecutive failures. A successful decision resets the failure count; explicitly retrying failed enrichment also resets it. A two-minute lease expires after a crashed or interrupted worker. Stale results cannot overwrite a newer lease. Approval rechecks pause, list membership, category settings, day, and daily allowance.

The existing lead pool has been reset for browser screening. Assignments and outreach history are preserved. Retired lead picture fields are removed; Chat avatar URLs are independent and retained. Worker metadata and proxy assignments are maintained by ordinary writes, with no migration jobs or startup backfills.

## Outreach and cleanup

An accepted recipient is followed if it is not already followed or requested. Confirmed follows are recorded for cleanup; public accounts may receive one like. Only confirmed follows advance the follow ramp. Approved claims remain permanent after an interrupted Instagram action, avoiding duplicate outreach.

After screening, roughly 30% of unfollowed public profiles with visible posts are revisited through Search by typing the lead's username and clicking its exact result before following. Unknown, empty, private, and already-followed profiles keep the direct route. Missing or temporarily unavailable results restore the exact lead URL; checkpoints and stop requests prevent following.

Notifications are checked daily. DMs begin on the next day only after a confirmed follow-back, using the message from the selected scraped list. Category settings are rechecked before Send. Message variations and placeholders are rendered once. An uncertain delivery stops that profile for review; it is never blindly resent.

Confirmed follows or requests are removed after the configured unfollow delay. Cleanup runs in the same automation sessions and preserves sender history. Browsing, screening, follows, DMs, pauses, and cleanup share the session deadline. Rest releases the browser slot.

Deploy matching Convex, server, and frontend changes together. No new manual login or API key is needed.
