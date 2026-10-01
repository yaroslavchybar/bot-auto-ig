# Server memory changes

The Rust VNC gateway runs inside the server's native controller alongside
Bun browser workers, Chromium, TigerVNC and Fluxbox. RFB listens only on loopback.
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
- Instagram: custom Rust transport, CAA login/password encryption, TOTP, DMs,
  reactions, uploads, and profile edits. At most 32 profile transport entries
  and four mobile commands; per-profile locks serialize session updates.
  Session cookies and authorization persist in Convex. Existing SDK sessions
  are reused without login; reconnect preserves their saved device identity.
- Scraper: Rust HTTP, source discovery, batches of 25, resume checkpoints,
  cooldowns, OpenRouter descriptions, and Jev classification. Convex subscriptions
  in the Bun worker wake native jobs; there is no idle native polling.
- Uploads: four active receivers, 32 pending files, 15-minute expiry. Photo and
  voice inputs: 10 MB; videos: 25 MB. The API receives file descriptors and
  streams each file through the selected account's proxy.
- VNC: 64 connections, 1 MiB maximum incoming WebSocket messages, 64 KiB RFB
  read buffers and awaited writes with timeouts.
- Routine workers: at most `AUTOMATION_MAX_CONCURRENCY`, default three. Convex
  subscriptions wake changed accounts; Rust timers wake resting accounts.

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

Mobile commands fetch the saved session and current proxy configuration together
through the authenticated `/api/chat/context` endpoint. One Convex query reads both
records in the same snapshot, and the response includes only the proxy fields needed
by the transport. Session load/status/logout keep their existing single-request paths.
The existing deployment workflow updates Convex before starting the new runtime.

The 32-entry mobile cache never evicts an active profile or one with a live reconnect
cooldown. Expired cooldowns are eligible for eviction. If every entry is active or
cooling down, requests for new profiles are rejected until capacity becomes available; the cache remains
bounded. Cooldowns remain local to the process and do not survive a runtime restart.

WebSocket read buffers are 16 KiB on VNC and both event-relay connections. Event
text transfers its owned bytes between Axum and Tungstenite without a new string
allocation. Both event connections have 1 MiB frame/message caps; awaited writes
provide backpressure. The VNC read buffer stays off the async future's inline storage.

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

## API and mobile migration validation

Compatibility fixtures exercise CAA login and TOTP, cookie persistence, authenticated
SOCKS connections and remote DNS, messaging, profile edits, streaming uploads,
scraper fallbacks/checkpoints, Telegram sessions, and public HTTP/WebSocket routing.
Live Instagram behavior and VPS memory have not been measured for this migration.
Browser automation, chat-cache/business commands, and Convex functions remain TypeScript.
