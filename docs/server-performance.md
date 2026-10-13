# Server memory changes

The Rust VNC gateway runs inside the server's native controller alongside
Bun browser workers, Chromium, TigerVNC and Fluxbox. Rust owns their worker/display
lifecycles and the shared browser-slot budget. RFB listens only on loopback.
The default desktop, Python websockify
and Supervisor were removed. A Rust controller supervises Bun and owns local
wakeup deadlines and temporary uploads. Routine workers exit between runs.

The image spoofer now serves HTTP and generates JPEGs directly in Rust. It
decodes each source once, applies EXIF orientation, fuses pixel transforms,
and checks complete decoded RGB pixels for uniqueness. The JPEG encoder uses
the optional SIMD implementation from [jpeg-encoder](https://github.com/vstroebel/jpeg-encoder).
Headers are checked before decoding: at most 12 million pixels and 15 MiB.
Only one image job runs at a time; at most 32 requests may wait or run.

## Local image benchmark

Measured on Windows on September 30, 2026, using release builds, Rust 1.98.1,
one 1080 × 1350 FFmpeg test-pattern JPEG and 50 variants. The original engine
was built from commit `f33b4be`. Three runs per engine were measured sequentially,
with no concurrent builds. Memory is sampled aggregate process-tree RSS every
20 ms; it includes FFmpeg children in the original engine.

| Engine                             | Median time | Median peak RSS |
| ---------------------------------- | ----------: | --------------: |
| Original Rust CLI spawning FFmpeg  |      5.66 s |        39.3 MiB |
| Rust pixel pipeline and JPEG codec |      5.13 s |        13.9 MiB |

That fixture used about 65% less peak memory and took about 9% less time.
Outputs passed decoded pixel uniqueness checks. These numbers do not predict
VPS results: CPU quotas, Linux shared pages, image size and image content differ.
Image output is intentionally changed, so the two encoders are not bit-identical.

## Other bounds

- Public API: Rust/Axum, 64 in-flight HTTP requests and 128 event sockets.
  JSON is capped at 1 MiB; media routes stream bodies with their own limits.
- Instagram: browser login, profile edits, and posting use Playwright. Rust
  collects likers using saved browser cookies and proxies; Apify discovers account
  posts. There is no mobile client, device state, or separate login session.
- Scraper: Rust HTTP, source discovery, batches of 25, resume checkpoints,
  cooldowns. Lead screenshot classification runs in the active browser worker; Rust-owned Convex
  subscriptions wake native jobs; there is no idle work polling.
- Uploads: four active receivers, 32 pending files, 15-minute expiry. Photo and
  voice inputs: 10 MB; videos: 25 MB. The API receives file descriptors and
  streams each file through the selected account's proxy.
- VNC: 64 connections, 1 MiB maximum incoming WebSocket messages, 64 KiB RFB
  read buffers and awaited writes with timeouts.
- Routine workers: at most `AUTOMATION_MAX_CONCURRENCY`, default three. Convex
  subscriptions and readiness calculations are native; Rust timers wake resting accounts.
- Content: one native manifest owner serializes assignments from API and browser
  workers. Writes replace manifests atomically; repeated allocations reuse their
  existing assignment. Thumbnail decoding is serialized and cached on disk.
- Previews: direct X11 capture and native JPEG encoding, with at most two captures
  running and an eight-second per-display cache. No FFmpeg process is launched.
- Subscriptions: one shared Rust Convex client multiplexes server queries. Browser
  workers use authenticated local sockets; closing a socket drops its subscription.

## Rust allocation and async review (October 1, 2026)

The spoofer reuses its RGB working frame for decoded JPEG verification and keeps
the encoded buffer across variants. EXIF and JPEG bytes go into one buffered file
write. This removes repeated full-frame allocations, JPEG rereads, and file rewrites.
Decoded-pixel uniqueness and source orientation still have regression coverage.

The API shares its configuration, authentication state, and route definitions through
`Arc`. Instagram form fields, inbox rows,
and avatar bodies move into their destination instead of being cloned. Resumed
scraper jobs borrow saved posts with `Cow`; checkpoint fields move into the payload.
Fixed proxy/link regexes, CAA templates, default headers, and device lists initialize
once through `LazyLock`, following the [regex performance guidance](https://docs.rs/regex/latest/regex/#avoid-re-compiling-regexes-especially-in-a-loop).

Upstream JSON still has byte limits, including chunked responses. Advertised
oversized bodies are rejected before reading. Bodies over 64 KiB parse through
`spawn_blocking`, with a semaphore limiting parsing to two active tasks. The
permit stays inside each blocking task if the HTTP caller disconnects, following
[Tokio's CPU-work guidance](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html).
HTTP clients already reuse their connection pools, as recommended by
[reqwest](https://docs.rs/reqwest/latest/reqwest/struct.Client.html).

Scraper jobs read the browser cookie jar and proxy together from the saved profile.
Every liker HTTP attempt reserves capacity through its fenced source lease.
Pause state, browser ownership, the hourly limit, and local sleep are checked before
dispatch. Quota and cooldown state persist in Convex across runtime restarts.
The existing deployment workflow updates Convex before starting the new runtime.

WebSocket read buffers are 16 KiB on VNC and public event connections. Public
events originate in Rust; there is no Bun event relay. Event connections have
1 MiB frame/message caps; awaited writes provide backpressure. The VNC read buffer
stays off the async future's inline storage.

Workspace Clippy settings flag redundant clones, large futures, and locks held
across awaits. Run `cargo fmt --all -- --check`,
`cargo clippy --workspace --all-targets --locked -- -D warnings`, and
`cargo test --workspace --locked` when changing native code.

### Image buffer comparison

Windows release builds with Rust 1.98.1, comparing the pre-review binary with the
updated binary. Inputs are RGB PNG gradients: `r = x % 256`, `g = y % 256`,
`b = (x + y) % 256`. Before/after runs alternate; one warmup per binary is excluded,
then three runs per binary produce the medians. Peak RSS comes from Bun's subprocess
resource usage. Each run checks successful output counts; the native pipeline
validates decoded-pixel uniqueness.

| Fixture                 | Before time | After time | Before peak RSS | After peak RSS |
| ----------------------- | ----------: | ---------: | --------------: | -------------: |
| 1024 × 768, 10 variants |      546 ms |     469 ms |       10.20 MiB |       9.98 MiB |
| 4000 × 3000, 5 variants |     3601 ms |    3494 ms |       80.18 MiB |      81.08 MiB |

The smaller fixture took about 14% less time; the larger one took about 3% less.
Peak RSS differences were small and mixed. Fewer allocations and file operations
are verified by the implementation; VPS throughput and memory need separate measurements.

## API migration validation

Fixtures exercise browser-cookie scraping, Apify discovery, scraper leases and
checkpoints, Telegram sessions, browser profile edits, and public HTTP/WebSocket routing.
Live Instagram behavior and VPS memory have not been measured for this migration.
React, Convex functions and Playwright browser actions remain TypeScript.
Content, worker supervision, desktop previews, profile/account services,
login/model coordination, proxy checks, clipboard and upload forwarding run in Rust.
Portable tests and Linux
cross-compilation cover the migration; live Linux desktop capture still requires
verification on a host running TigerVNC and Fluxbox. Docker was not used to validate
this migration.

The October 5 migration preserves the existing credential encryption format.
Profile leases hold SQLite OS locks across browser cleanup; folder maintenance
and worker startup share the native process gate. Pending rename/deletion work
retries from Convex state after a restart.

Account coordination limits browser login to four concurrent operations.
Proxy probes are limited to eight; the Work proxy exit cache holds at most 1,000
entries for six hours. Login proxy probes always bypass that cache.
Browser login attempts have unique IDs and explicit cancellation acknowledgements.
Rust releases proxy claims after browser cleanup; unconfirmed cancellation keeps
the exit IP quarantined until the runtime restarts.
Clipboard selections live in a native X11 event loop with bounded transfers.
File picker uploads stream over Unix sockets or Windows named pipes; the browser
worker still owns the Playwright chooser. Ownership is checked before upload EOF.

Model posts hold a native action lease until the browser result is saved.
Disconnects and uncertain results retain pending state for operator review.
Confirmed posts with a failed database save remain pending too.
Live Linux clipboard behavior still needs verification on a desktop host.

October 5 checks: 85 Rust tests, 192 server tests, 162 Convex tests and 51 UI tests
passed. Type checks, lint, Windows debug/release builds and Linux Clippy with all
targets passed. The optional native clipboard test needs a disposable Linux
display in `NATIVE_CLIPBOARD_TEST_DISPLAY`; it covers Unicode, large incremental
transfers and ownership changes. No Docker, commits or deployments were used.
