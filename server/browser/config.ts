// Single source of truth for browser resolution.
// Window size, VNC desktop geometry and spoofed fingerprint screen must match,
// otherwise sites see e.g. screen.width=3840 on a 1366px window (fingerprint leak).
export const BROWSER_WINDOW_WIDTH = 1366
export const BROWSER_WINDOW_HEIGHT = 768

// Force the spoofed fingerprint screen to match the real window.
// fingerprint-generator has no 1366x768 in its dataset (exact constraint throws),
// so we generate normally and overwrite afterwards.
export function normalizeFingerprintScreen<T extends { screen?: Record<string, unknown> }>(
  fingerprint: T,
): T {
  const screen = fingerprint?.screen
  if (!screen || typeof screen !== 'object') return fingerprint
  screen.width = BROWSER_WINDOW_WIDTH
  screen.height = BROWSER_WINDOW_HEIGHT
  screen.availWidth = BROWSER_WINDOW_WIDTH
  screen.availHeight = BROWSER_WINDOW_HEIGHT
  screen.availLeft = 0
  screen.availTop = 0
  screen.screenX = 0
  screen.pageXOffset = 0
  screen.pageYOffset = 0
  screen.outerWidth = BROWSER_WINDOW_WIDTH
  screen.outerHeight = BROWSER_WINDOW_HEIGHT
  screen.innerWidth = BROWSER_WINDOW_WIDTH
  screen.innerHeight = BROWSER_WINDOW_HEIGHT
  return fingerprint
}

export function parseProxy(
  value: string | null | undefined,
): { server: string; username?: string; password?: string } | undefined {
  const raw = String(value || '').trim()
  if (!raw || raw.toLowerCase() === 'none') return undefined
  const legacy = raw.match(
    /^(?:(https?|socks5):\/\/)?([^:@/]+):(\d+):([^:]+):(.+)$/,
  )
  if (legacy) {
    return {
      server: `${legacy[1] || 'http'}://${legacy[2]}:${legacy[3]}`,
      username: legacy[4],
      password: legacy[5],
    }
  }
  const url = new URL(raw.includes('://') ? raw : `http://${raw}`)
  if (!['http:', 'https:', 'socks5:'].includes(url.protocol) || !url.hostname)
    throw new Error('Invalid proxy URL')
  return {
    server: `${url.protocol}//${url.host}`,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
  }
}
