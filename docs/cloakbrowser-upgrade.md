# CloakBrowser stable upgrade

Reviewed the latest eight released wrapper entries on October 22, 2026:
0.6.3, 0.6.2, 0.6.1, 0.6.0, 0.5.12, 0.5.11, 0.5.10 and 0.5.9.
Unreleased changes and Preview-only browser features are excluded.
Sources: [official changelog](https://github.com/CloakHQ/CloakBrowser/blob/main/CHANGELOG.md),
[JavaScript API](https://github.com/CloakHQ/CloakBrowser/blob/main/js/README.md),
[Chromium 155 Stable release](https://github.com/CloakHQ/CloakBrowser/releases/tag/chromium-v155.0.8059.39.1-pro).

| Release | Relevant changes |
| --- | --- |
| 0.6.3 | Whole wheel notches for humanized target scrolling, revised mouse and typing timing, fixed/absolute overlay targeting, GeoIP locale fallback. The async event-loop fix applies to Python/.NET, not our JavaScript service. |
| 0.6.2 | Humanized actions work with Playwright 1.64. Our supported 1.63 version does not require an upgrade. |
| 0.6.1 | Element reads use the isolated world; dropdown selection is faster. |
| 0.6.0 | One action engine handles all Playwright selectors, frames and handles; strict matching, standard action errors, trusted input, options and deadlines. |
| 0.5.12 | Horizontal reveal and sub-pixel scrolling fixes; number-input typo correction. |
| 0.5.11 | Binary/font diagnostics and archive extraction improvements. |
| 0.5.10 | GeoIP and license failures surface instead of silently choosing incorrect defaults. |
| 0.5.9 | Better selector/target fidelity and session-seat reporting. |

## Migrated

- Updated the wrapper to 0.6.3 and selected `releaseChannel: 'stable'` explicitly.
  Keep binary auto-update enabled; do not pin a Preview build.
- Let Cloak reveal and move to a pinned target as part of one click/fill/hover.
  Removed our duplicate pre-click scrolling and hover.
- Removed the generic live-click CSS-marker workaround; scoped and role locators
  now work directly. The Like marker remains a conditional identity guard so it
  stops matching as soon as that exact heart changes to Unlike.
- Attach the visible desktop pointer to the public `patchPage()` engine's raw
  movement hook. Re-patching the context no longer captures input methods.
- Removed exception branches for legacy Cloak action errors. Optional DOM
  failures still skip/retry; browser, account and selector failures propagate.

## Retained

- X11 cursor, discrete Reels wheel and Back input. Whole-notch humanized browser
  scrolling is not an OS input API. Playwright mouse wheel remains a raw
  pass-through, and its public mouse button API does not support Back.
- General feed/modal scrolling, which has session cancellation, exact requested
  distance, pacing and an early completion callback. A full vendor wheel burst
  does not expose our stop predicate through the public entry point.
- Application checks for content identity, screenshots, visible grid geometry,
  budgets, profile locks, persisted cross-device fingerprint seeds and shutdown.
  These are not generic input behavior supplied by the wrapper.

Validation uses unit and public-engine integration tests without launching a
browser. A live Instagram smoke test remains a separate, explicitly requested
check. The VPS is updated only through the normal deployment workflow.
