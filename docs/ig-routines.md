# Daily IG routines

Manage a routine in the automation popup. Select sender profile lists, choose the daily browsing and session ranges, and optionally enable outreach with a recipient lead list and message.

In Profiles Manager:

- **Logged in** allows warm-up sessions. Turning it off stops further activity at the next checkpoint.
- **Ready for outreach** allows messaging once the automation's minimum activity day is reached. Browsing continues during outreach.

Enabled routines run around the clock while the server is online. The worker runs one profile at a time, immediately continuing to the next eligible profile. Each profile receives a 30–60 minute daily browsing budget, split into shorter sessions with a separately selected rest period after each session. Resting profiles do not hold the browser slot. When no profiles are eligible, the worker checks again every 15 seconds.

An activity day advances once the assigned browsing budget is completed. Missed days do not advance progress. The daily DM allowance increases only after a day with confirmed outreach and is capped at the configured maximum. A session sends up to three messages after browsing, subject to the remaining allowance and available Ready leads. Daily counters reset at midnight UTC; there are no active-hour or timezone settings.

Add or remove profiles through Lists Manager. Multiple selected lists do not duplicate a profile. A profile may belong to only one enabled automation. Removing and readding a profile preserves progress and delivery history.

The Leads tab accepts pasted usernames/profile URLs or CSV with a `username`, `profile_url`, `instagram`, or `url` column. Preview up to 500 rows per import. Imports normalize and deduplicate usernames globally and preserve existing contact status. Review imported leads and mark eligible recipients Ready. Each recipient is assigned to its sender on reservation and cannot be automatically requeued after contact.

Delivery reservations and budgets are updated atomically. The worker obtains a one-time send authorization before pressing Enter; ambiguous results stop that account for review. Resolve the recipient as contacted, replied, or do not contact in Leads, then clear the account's issue in the popup. Server restart recovery preserves progress and marks interrupted deliveries uncertain.

Profile setup and login are manual. These changes do not upload profile pictures or log in automatically. Browser message selectors require validation against the logged-in Instagram UI before live outreach; automated tests use simulated browser interactions.

Deploy the Convex schema/functions and the server/frontend together. Saving settings does not enable a routine. Existing graph automations can be replaced by saving their settings in the new popup while disabled.
