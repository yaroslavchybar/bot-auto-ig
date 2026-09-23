# Daily IG routines

Manage a routine in the automation popup. Select sender profile lists, browsing/session ranges, and optionally enable outreach with a lead list and message. Saving does not enable the routine.

Logged in allows browsing. Ready for outreach allows messaging after the configured activity day. Login and account setup are manual.

Enabled routines run around the clock while the server is online, one profile at a time. Each profile gets a configurable 1–100 minutes of browsing daily (30–60 by default), split into 1–60 minute sessions with rest periods. Resting profiles release the browser slot. When none are eligible, the worker checks every 15 seconds.

An activity day advances after completing the daily budget. Missed days do not advance progress. DM allowance grows after days with confirmed outreach, up to the cap. Sessions send up to three DMs after browsing. Daily counters reset at midnight UTC.

Add/remove profiles through Lists Manager. Overlapping lists do not duplicate profiles. Each profile can belong to only one enabled automation. Removing/readding preserves progress.

## Leads

Add source Instagram profiles in Scraper. The scraper collects recent post likers, deduplicates them by Instagram ID, and saves them to the selected lead list. Only public accounts classified as male and ready for outreach are eligible for DMs.

Leads store their Instagram ID, username, classification, sender assignment, DM and follow state. Lead list membership and outreach availability are indexed separately. There is no separate attempts table or delivery history.

A new interaction requires dmSent=false, followed=false, and no senderId. The server atomically assigns senderId and charges the daily allowance before opening the recipient. Claims are never automatically released, even after failure, restart, list changes, or unfollow. Claim requests are not retried after HTTP failures. This may skip a recipient without sending, but prevents another session or sender from trying again.

The current session can follow a claimed recipient and then send its DM. dmSent becomes true only after confirmation. If delivery cannot be confirmed, the profile stops with an issue; check Instagram before clearing it in the automation popup. The recipient remains claimed and skipped.

## Follows

If Message is missing and Follow is available, the routine follows first, records followed=true and followDate after confirmation, then waits for Message. Existing follows are left alone. Private accounts may still require approval; unavailable messaging stops delivery for review.

The same sender unfollows confirmed follows (or cancels confirmed requests) in its next eligible session after seven full days. Cleanup runs before browsing in bounded batches and requires an enabled routine and eligible sender. Outreach need not remain enabled. Unfollow sets followed=false, retaining followDate and senderId; it never requeues the lead.

There is no pending-action recovery. If the process stops between an Instagram action and saving its result, the boolean may remain false. The sender claim prevents repeats. An unrecorded follow has no automatic cleanup date and must be checked manually.

Deploy Convex, server, and frontend together. Browser controls have simulated tests and still require validation against the live Instagram UI before outreach.
