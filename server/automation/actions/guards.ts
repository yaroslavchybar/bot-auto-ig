// Read-only safety checks: observe layout, never drive input.
// They keep the cursor off browser chrome and clicks off stale targets.

export const PROFILE_URL = /instagram\.com\/[A-Za-z0-9._]+\/?$/
const NOT_A_USER = /^\/(explore|reels|direct|stories|accounts|about|legal|p|tv)\//

// User links are single path segments; filter out app routes.
// (Verified against live DOM: no <header> in articles, likes count is a
// span[role=button], highlights are links to /stories/highlights/.)
export function isUserHref(href: string | null): href is string {
  return !!href && /^\/[^/?#]+\/?$/.test(href) && !NOT_A_USER.test(href)
}

// The point we would tap must be inside the viewport. Off-screen boxes
// (stale fallback target above the viewport) would send the cursor to the
// window top or make Playwright jump-scroll on button clicks.
export function clickPointOnScreen(
  box: { x: number; y: number; width: number; height: number },
  vp: { width: number; height: number },
): boolean {
  const x = box.x + box.width * 0.5
  const y = box.y + Math.min(box.height * 0.5, 500)
  return x > 0 && x < vp.width && y > 0 && y < vp.height
}
