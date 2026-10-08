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
key stable: losing it makes imported credentials unreadable. Mobile Chat
sessions live in Convex; content and message caches use the persisted `data/` volume. Model setup progress
and shared full-name variations live in Convex.
Unreadable credentials appear as Invalid and are skipped for new profiles;
the stored rows are preserved so restoring the key can recover them.
Back up the key separately from Convex.

Accounts with a missing or expired mobile session show **Reconnect needed** and a
**Reconnect** button on desktop and mobile. It reuses saved credentials and the
profile's Work proxy with the Rust client. During login the button is disabled;
success refreshes the row to Connected. Failed attempts show an error and allow
retry without deleting the previous session. Session version metadata is stored
in Convex so lists can identify sessions needing login without loading their files.
Existing TypeScript sessions are imported without another login. Reconnect reuses
the saved device IDs, model, cookies, and device signing key. Failed login attempts
leave the saved session intact.
Instagram rate limits show a readable message. Login respects `Retry-After`
without sending another login request during the cooldown; when Instagram sends
no retry time, the default cooldown is one hour.

The **Create Profile** dialog selects a model and a count. It uses unused
credentials and saved **Work** proxies, respecting each proxy's profile limit.
Import login proxies manually from TXT on the Proxies page. The import popup
sets HTTP or SOCKS5, Work or Login, and the country for the imported batch.
Rust owns account endpoints, imports, assignments, reconnect, proxy checks and
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
On day 3, after a browser warmup session closes, the mobile Chat session logs in
through the profile's saved Work proxy. Username and full name are separate
updates; the full-name update waits until the model has a full name configured.
Profiles already marked Logged in skip browser login and connect the mobile
session through their Work proxy after warmup.

Rust owns model enrollment, Kyiv calendar dates, name generation, mobile setup
and reconciliation. Playwright posting stays in TypeScript. A native socket lease
holds the account action lock until the browser result is saved. A disconnected
browser or uncertain Instagram result leaves pending work for operator review;
the scheduler cannot repeat it automatically.
If the posting lease disconnects or times out, the browser action observes
cancellation and the caller waits for it to finish before reusing the page.

Required production secrets:

- `IG_CREDENTIALS_KEY`: 32 random bytes encoded as 64 hex characters.
- `OPENROUTER_API_KEY`: already used by the scraper; GPT-6 Luna generates
  usernames after imported examples and subtle full-name variations.

Create one automation per model and enable it after profiles are browser logged in.
The automation starts model setup from the browser login date; browsing starts
on day 2, followed later by outreach. Its Profiles tab
shows setup progress and errors. Disabling the automation pauses model setup.
Day 1 is the browser login date in the Europe/Kyiv calendar. After a browser
warmup session on day 3, the Rust mobile client logs in. It changes the
username and full name in separate steps. A full name added later is still
applied, even when the profile is past day 3 or already posting. Posting can
continue while no full name is configured. One full-name variation is shared by four accounts.
From day 4, after a browser warmup session, it changes the avatar and starts daily
posts without captions, up to the account's saved random target from the automation's
warm-up post range (default 9–9). Mobile setup starts in the background while the
browser worker can move to its next profile. Each post uses a different uploaded
image; if the bank is empty, posting waits for the next upload. A failed or uncertain mobile API
action is shown for review rather than retried blindly. In the automation's
Profiles tab, check Instagram and mark the action as successful, or confirm
it failed to let the worker retry. Model moves reset outreach readiness.
After Chat login and each confirmed username change, the profile name follows
the IG username. The existing profile maintenance flow moves its browser data
directory; sync errors appear on the connected account and retry in the background.
After the account's post target is reached, the automation marks the profile ready for outreach.

The Rust spoofer runs in its own Docker container, using the shared `data/`
volume. The server submits image jobs over the private Docker network. Warmup
reuses the connected Chat session and its saved proxy.

The spoofer handles one image at a time. Docker limits it to 0.45 CPU and
768 MB memory. It decodes the source once, creates and verifies JPEG variants in Rust,
and accepts at most 12 megapixels before decoding. This is 15% of the three CPU cores
available to this VPS. The app's container has a separate CPU allocation.
For local development outside Docker, run `target/debug/spoof serve` after
`cargo build --workspace`, with `SPOOFER_DATA_ROOT` and `SPOOFER_URL` set to matching paths.
