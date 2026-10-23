# Dependency upgrade notes

The repository tracks stable releases. Runtime pins remain Bun 1.4.4, Node 24.x, Rust 1.98.1, and Debian Bookworm. CloakBrowser's wrapper remains at the latest stable 0.6.3; browser downloads use the stable channel.

- Vite+ is upgraded as one set: `vite-plus` and the `vite` npm alias both use `@voidzero-dev/vite-plus-core` 1.4.0, with Vitest 5.0.5 matching its declared dependency set.
- Rand 0.10 uses `SysRng` for credential IV entropy and `random_range` for non-security cooldown jitter. AES-GCM 0.11, HMAC 0.13, and SHA-2 0.11 preserve the existing v1 credential wire format; a fixed legacy decrypt fixture covers this.
- Convex 1.48 and `convex-test` 0.0.64 use one bounded `.paginate()` call per profile/proxy search query, filtering that page and returning its native continuation cursor. Sparse pages can be continued with Next. This avoids unsupported nested pagination and custom positional cursors. See [Convex pagination](https://docs.convex.dev/database/pagination).
- Timing tests now respect transaction-pinned time instead of assuming a frozen wall clock always equals the database snapshot. The shared test helper advances the fake clock past the latest snapshot before exact deadline assertions. Before-deadline rejection, deadline acceptance, retries, and cross-midnight recovery remain covered. See the [convex-test changelog](https://github.com/get-convex/convex-test/blob/main/CHANGELOG.md).

Official migration references: [Convex pagination](https://docs.convex.dev/database/pagination), [Rand 0.10](https://docs.rs/rand/0.10/rand/), [AES-GCM](https://docs.rs/aes-gcm/0.11/aes_gcm/), [HMAC](https://docs.rs/hmac/0.13/hmac/), and [Vite+](https://viteplus.dev/).
