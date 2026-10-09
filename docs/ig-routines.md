# Daily IG routines

Manage a routine in the automation popup. Select one model, browsing/session ranges, and optionally enable outreach. In Outreach, add scraped-list assignments, choosing profiles and a message for each list. Saving does not enable the routine.

A profile can be assigned to several scraped lists in the same automation. It rotates through its lists after each claim, skips empty lists, and shares one daily DM target across all of them. Each scraped list has one assignment. “All profiles in this model” includes future model members; individual selections stay explicit. Model membership still determines which profiles the automation can run.

Logged in allows browsing. Ready for outreach allows messaging after the configured activity day. Login and account setup are manual.

Warm-up & activity settings include a total post range (1–100, default 9–9). Each account gets one saved random target and publishes at most one post per day from day 4. Recorded posts and dates must reach that target before setup marks outreach ready. Changing the range assigns new targets to unfinished accounts without removing their posts; completed setups remain ready.

Enabled routines run while the server is online, one profile at a time. Each profile gets a configurable 1-100 active minutes daily (30-60 by default), split into 1-60 minute sessions with rest periods. Browsing, cleanup, DM preparation, sending, and DM pauses share this budget. Rest starts after the whole session ends and releases the browser slot.

An activity day advances after completing the daily budget. Missed days do not advance progress. The daily DM target grows by a random 1-4 after each day with confirmed outreach, up to the cap. The increase is saved once and applies on the next UTC day. Sessions alternate browsing and random batches of 1-5 DMs. Each session aims for a share of the remaining daily target, reserving sending time before allocating browsing time. DM pauses are random 30-90 seconds, shortened within that range when time is tight. Daily counters reset at midnight UTC; sessions stop at the day boundary.

Add/remove profiles through Lists Manager. Overlapping lists do not duplicate profiles. Each profile can belong to only one enabled automation. Removing/readding preserves progress.

## Leads

Add source Instagram profiles in Scraper. The scraper collects recent post likers, deduplicates them by Instagram ID, and saves them to the selected lead list. Only public accounts classified as male and ready for outreach are eligible for DMs.

Leads store their Instagram ID, username, classification, sender assignment, DM and follow state. Claims also save the source scraped list and automation. Lead list membership and outreach availability are indexed separately. There is no separate attempts table or delivery history.

A new interaction requires dmSent=false, followed=false, and no senderId. The server atomically assigns senderId and reserves a slot in the daily target before opening the recipient. Claims are never automatically released, even after failure, restart, list changes, or unfollow. Claim requests are not retried after HTTP failures. This may skip a recipient without sending, but prevents another session or sender from trying again.

The current session can follow a claimed recipient and then send its DM. dmSent becomes true only after confirmation. If delivery cannot be confirmed, the profile stops with an issue; check Instagram before clearing it in the automation popup. The recipient remains claimed and skipped.

Only confirmed deliveries count toward the displayed target. If preparation reaches the session deadline before Send, the claimed lead is skipped without flagging the profile for review. Confirmed blocked and unsent messages release their target slot once so a different lead can be tried; the original lead remains claimed. Uncertain delivery after Send keeps its slot and stops the profile for review. Missing leads, delivery issues, downtime, or insufficient time can prevent completing the target. The UI shows delivered/target and marks an exhausted budget with an incomplete target.

## Follows

Before every DM, the routine follows the recipient if not already followed or requested, records followed=true and followDate after confirmation, then opens Message. Existing follows and requests are left alone and are not recorded for automatic cleanup. If following cannot be confirmed, no DM is sent. Private accounts may still require approval; unavailable messaging stops delivery for review.

Outreach settings include an unfollow delay range (1–365 days, default 7–7). Each claimed recipient gets a saved random delay, starting when the follow is confirmed. The same sender unfollows confirmed follows (or cancels confirmed requests) in its next eligible session after that deadline. Changing the range does not move existing deadlines; follows saved before this setting keep seven full days. Cleanup runs before browsing in bounded batches and requires an enabled routine and eligible sender. Outreach need not remain enabled. Unfollow sets followed=false, retaining followDate and senderId; it never requeues the lead.

There is no pending-action recovery. If the process stops between an Instagram action and saving its result, the boolean may remain false. The sender claim prevents repeats. An unrecorded follow has no automatic cleanup date and must be checked manually.

Deploy Convex, server, and frontend together. Browser controls have simulated tests and still require validation against the live Instagram UI before outreach.
