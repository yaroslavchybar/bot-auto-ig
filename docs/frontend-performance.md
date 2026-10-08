# Browser performance

Checked on September 30, 2026.

The sidebar and header stay mounted during protected-page navigation. Hashed JavaScript and CSS now have explicit one-year browser caching. HTML revalidates so a new build can load its new asset filenames. This follows [web.dev's HTTP caching guidance](https://web.dev/articles/http-cache). These headers apply to the production Nginx server, not Vite's development server.

## Memory changes

- Profiles, proxies, and Instagram accounts load up to 50 rows at a time. Server-side searches stop after five batches and return a continuation cursor, so sparse searches can yield a partial or empty page with more pages available. Profile/proxy batches also limit bytes read; filtered proxy batches limit scanned rows. Proxy usage includes records outside the current page. Available account counts are exact through 100, then display 100+; profile creation supports batches of at most 100.
- Profile lists omit cookies and browser sessions. Editing loads the full selected profile.
- Images load near the viewport, use disk-cached 512px thumbnails, and release image blobs off screen or in hidden tabs. Original uploads are unchanged. Rust serializes thumbnail decoding and bounds decoder memory.
- VNC header and page share their sessions request and poller. Off-screen previews release their images and stop polling.
- Shared clocks and chat polling pause in hidden tabs. Database connections close when the protected UI unmounts.
- Model cards and dialogs share content metadata while the models page is open. Updates reload the affected model only. Detail tabs mount on first use and retain unsaved drafts; hidden profile tabs stop their query.
- Login loads the protected shell separately. Monitoring loads only when configured. Tailwind scans the frontend sources explicitly, following its [source detection documentation](https://tailwindcss.com/docs/detecting-classes-in-source-files).

Whole inactive pages are unmounted. Keeping every route alive would retain its DOM and state; React's [Activity documentation](https://react.dev/reference/react/Activity) explains that hidden Activity preserves them. The lightweight shell and local drafts are the deliberate exceptions.

## Production browser measurements

Two production builds were tested in fresh headless Chrome sessions with mocked APIs and identical fixtures: 1,000 profiles with 2KB cookie fields, 300 proxies, 250 Instagram accounts, and one model. JavaScript heap was measured after forced garbage collection. This fixture excludes live VNC decoding and large photo galleries.

| Measurement                              |        Before |         After |
| ---------------------------------------- | ------------: | ------------: |
| Profiles JavaScript heap                 |     64.39 MiB |      7.26 MiB |
| Profiles DOM nodes                       |        67,250 |         3,606 |
| Profile rows rendered                    |         1,000 |            50 |
| Proxies JavaScript heap                  |     20.11 MiB |      6.44 MiB |
| Instagram accounts JavaScript heap       |      7.30 MiB |      5.91 MiB |
| Heap after five navigation cycles        |     73.65 MiB |      9.32 MiB |
| Model content requests, card plus dialog |             2 |             1 |
| Database connections after logout        |             1 |             0 |
| Preloaded JavaScript, gzip               | 185,139 bytes | 104,735 bytes |

The JavaScript byte measurement includes entry and module-preload files referenced by HTML, with monitoring disabled in both builds. It excludes later route imports. The reduction is about 43%.

Chrome's tab memory number includes more than JavaScript heap, so these results do not predict a specific replacement for the screenshot's 164 MB. Chrome documents the distinction in its [memory profiling guide](https://developer.chrome.com/docs/devtools/memory-problems).

## Validation and rollout

Type checks, lint, both application builds, 263 server tests, 134 Convex tests, 34 frontend unit tests, and 26 UI tests passed. Two existing browser integration tests were skipped. Production browser checks passed on desktop and mobile with no runtime errors; shell identity and unsaved model drafts were preserved.

Deploy the new Convex queries and indexes with the matching server/frontend build. Rebuild the frontend image to enable its caching headers. No deployment was performed. Docker was stopped locally, so container builds and `nginx -t` were not run; Nginx directives were checked against its official documentation.

Substring search scans records server-side to preserve existing behavior, with a fixed five-batch budget per request. Continuing through many pages still consumes database reads; a much larger dataset would need a separate indexed-search design. Read budgets follow Convex's [transaction limits](https://docs.convex.dev/production/state/limits) and [pagination guidance](https://docs.convex.dev/database/pagination).
