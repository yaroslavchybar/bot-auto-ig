# Server memory changes

The Rust VNC gateway has its own container. Bun browser workers, Chromium,
TigerVNC and Fluxbox stay in the server. The default desktop, Python websockify
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

| Engine | Median time | Median peak RSS |
| --- | ---: | ---: |
| Original Rust CLI spawning FFmpeg | 5.66 s | 39.3 MiB |
| Rust pixel pipeline and JPEG codec | 5.13 s | 13.9 MiB |

That fixture used about 65% less peak memory and took about 9% less time.
Outputs passed decoded pixel uniqueness checks. These numbers do not predict
VPS results: CPU quotas, Linux shared pages, image size and image content differ.
Image output is intentionally changed, so the two encoders are not bit-identical.

## Other bounds

- Chat SDK clients: 32 entries. Saved session hashes: 64 entries. Disk sessions remain reusable.
- Uploads: four active receivers, 32 pending files, 15-minute expiry. Photo and
  voice inputs: 10 MB; videos: 25 MB. The API receives file descriptors and
  streams each file through the selected account's proxy.
- VNC: 64 connections, 1 MiB maximum incoming WebSocket messages, 64 KiB RFB
  read buffers and awaited writes with timeouts.
- Routine workers: at most `AUTOMATION_MAX_CONCURRENCY`, default three. Convex
  subscriptions wake changed accounts; Rust timers wake resting accounts.
