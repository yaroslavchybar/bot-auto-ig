# IG account onboarding

`Lists Manager` is shown as **Models**. Existing list IDs and profile assignments
are kept. Each model can hold a base full name, desired usernames, and separate
post and avatar banks. The bank generates 50 variants per uploaded image using
the vendored `spoof` command.
Rust owns the content bank, manifest writes, generation tracking, thumbnails, and
variant assignments. Browser actions allocate content through the native controller,
so API requests and workers share one manifest owner.
The Models page shows a gallery of model cards. Open a card to upload and view
that model's post images and avatars, switch to Usernames & full names to manage
name pools, or view and assign its profiles. Imported full names are used in order for groups of four
accounts; later variations are generated from the base name.
The Edit model action opens this same popup on the names tab, where the model
name can also be changed.

The **IG Accounts** page imports one `username:password:base32-2FA-key` per line.
Rust encrypts each credential with `IG_CREDENTIALS_KEY` (64 hex characters)
before saving it to the Convex `igAccounts` table. Convex stores ciphertext and a
keyed username lookup hash; the key stays in the server environment. Keep that
key stable: losing it makes imported credentials unreadable. Browser cookies
live on each saved profile in Convex; content uses the persisted `data/` volume. Model setup progress
and shared full-name variations live in Convex.
Unreadable credentials appear as Invalid and are skipped for new profiles;
the stored rows are preserved so restoring the key can recover them.
Back up the key separately from Convex.

Connection status reflects the browser login. There is no separate mobile login,
reconnect, device state, or mobile logout. Browser cookies are refreshed whenever
the saved profile opens and closes. To refresh an expired Instagram session,
open that browser profile and sign in again. Account credentials stay encrypted.
Deleting a profile also deletes its linked encrypted IG credentials when browser
and profile-folder cleanup finishes. Credentials are not returned to Available.

The **Create Profile** dialog selects a model and a count. It uses unused
credentials and saved **Work** proxies, respecting each proxy's profile limit.
Import login proxies manually from TXT on the Proxies page. The import popup
sets HTTP or SOCKS5, Work or Login, and the country for the imported batch.
Rust owns account endpoints, imports, assignments, browser login, proxy checks and
the proxy blacklist. It keeps the existing AES-256-GCM credential format and keyed
username lookup, so saved credentials use the same key.
Rust consumes login-work subscriptions and owns retries, proxy claims and cooldowns.
The private Bun callback runs only Playwright browser login and saves browser cookies.
Login runs in the background. The app checks the Work proxy's actual exit
country through `ipwho.is`, then tries distinct, non-blacklisted Login proxy
IPs in that country. Two Instagram login rejections on different IPs flag the
credential. Other errors pause and retry in an hour. The blacklist is visible
on the Proxies page.
The app claims a Login proxy in Convex before using it, with a 15-minute
expiry if a worker stops. After a successful browser login, that Login proxy
cools down for a random 3–5 days before another account can use it. The
Proxies page shows when a Login proxy is available.
Browser login runs headless. Its success time is stored in Convex and starts
the model setup calendar. On the next Europe/Kyiv calendar day, the automation
starts feed browsing through the saved Work proxy, using its daily time budget.
From day 3, the active automation browser updates the username and full name
through Instagram's Accounts Center. The full-name update waits until the model
has a full name configured. From day 4, it clicks the current profile picture
on the own-profile page and uploads the model's allocated avatar. These edits
do not consume the scraper request quota.
Each browser edit holds a native account lease until its verified result is saved.
An interrupted or unconfirmed save remains pending for review. Unavailable
usernames can try the remaining generated candidates in the same lease.
The credential username is updated after confirmation; the saved browser profile
folder is renamed after the browser closes, preserving its cookies and device.
Rust owns model enrollment, Kyiv calendar dates, name generation
and reconciliation. Profile edits and posting use Playwright in TypeScript. A native socket lease
holds the account action lock until the browser result is saved. A disconnected
browser or uncertain Instagram result leaves pending work for operator review;
the scheduler cannot repeat it automatically.
If the posting lease disconnects or times out, the browser action observes
cancellation and the caller waits for it to finish before reusing the page.

Required production secrets:

- `IG_CREDENTIALS_KEY`: 32 random bytes encoded as 64 hex characters.
- `OPENROUTER_API_KEY`: already used by the scraper; GPT-6 Luna generates
  usernames after imported examples and subtle full-name variations.

Warm-up accepts a plain-English topic description (up to 1,000 characters).
Normal `openai/gpt-6-luna` generates short Instagram search phrases for Explore
post searches on warm-up days 1–4 and week-one account searches through day 7.
Post searches use typed hashtags and native result clicks, followed by scrolling
the post grid. From day 5, browsing uses the enabled Home feed/Reels surfaces.
The worker shares in-flight generation and caches
phrases per description for 24 hours; restart or an edited description regenerates them.
Generation failures skip topic searches for a minute while enabled Feed/Reels
browsing continues. Blank descriptions use normal browsing without generation.
Screenshot relevance checks always use the original description, preserving exclusions,
rather than the generated search phrase.

Warm-up topic filtering uses `openai/gpt-6-luna-decisions` through the same
OpenRouter key and the same JPEG image format as lead screening. It judges the
visible post, current reel frame, or profile screenshot, including any text visible in the image. A topic
decision must reach 70% confidence. Followed accounts remain included. Unknown
author layouts remain viewable, but likes and saves require a confirmed followed
author or a positive topic decision. Caption-free images can qualify; missing screenshots or failed decisions cannot
qualify an unfollowed account for engagement. Capture and classification share a twelve-second limit and the result is reused when
the same post is viewed and engaged with. Screenshots stay in memory and are not saved or logged.

Create one automation per model and enable it after profiles are browser logged in.
The automation starts model setup from the browser login date; browsing starts
on day 2, followed later by outreach. Its Profiles tab
shows setup progress and errors. Disabling the automation pauses model setup.
Day 1 is the browser login date in the Europe/Kyiv calendar. After a browser
warmup session on day 3, the browser changes the
username and full name in separate steps. A full name added later is still
applied, even when the profile is past day 3 or already posting. Posting can
continue while no full name is configured. One full-name variation is shared by four accounts.
From day 4, in the same browser after warmup, it changes the avatar and starts daily
posts without captions, up to the account's saved random target from the automation's
warm-up post range (default 9–9). The browser worker moves to its next profile after closing the current session. Each post uses a different uploaded
image; if the bank is empty, posting waits for the next upload. An uncertain browser
action is shown for review rather than retried blindly. In the automation's
Profiles tab, check Instagram and mark the action as successful, or confirm
it failed to let the worker retry. Model moves reset outreach readiness.
After the browser closes following a confirmed username change,
the profile name follows the IG username. The existing profile maintenance flow moves its browser data
directory; sync errors appear on the connected account and retry in the background.
After the account's post target is reached, the automation marks the profile ready for outreach.

The Rust spoofer runs in its own Docker container, using the shared `data/`
volume. The server submits image jobs over the private Docker network. Warmup
uses the saved browser profile and its Work proxy. Scraping and monitoring use the saved browser sessionid cookie and Work proxy.

The spoofer handles one image at a time. Docker limits it to 0.45 CPU and
768 MB memory. It decodes the source once, creates and verifies JPEG variants in Rust,
and accepts at most 12 megapixels before decoding. This is 15% of the three CPU cores
available to this VPS. The app's container has a separate CPU allocation.
For local development outside Docker, run `target/debug/spoof serve` after
`cargo build --workspace`, with `SPOOFER_DATA_ROOT` and `SPOOFER_URL` set to matching paths.
