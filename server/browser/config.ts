// Single source of truth for browser resolution.
// The page viewport and spoofed screen stay 1366x768 (common laptop). The
// VNC desktop is taller (960): the real window is viewport + Chrome's own
// UI (~900px), and a desktop shorter than the window lets the toolbar slip
// off-screen, where Chrome then remembers the bad position forever.
export const BROWSER_WINDOW_WIDTH = 1366
export const BROWSER_WINDOW_HEIGHT = 768
export const BROWSER_DESKTOP_HEIGHT = 960

export function parseProxy(
  value: string | null | undefined,
  protocol: string | null | undefined = 'http',
): { server: string; username?: string; password?: string } | undefined {
  const raw = String(value || '').trim()
  if (!raw || raw.toLowerCase() === 'none') return undefined
  const scheme = protocol?.trim().toLowerCase() || 'http'
  if (!raw.includes('://') && !['http', 'https', 'socks5'].includes(scheme))
    throw new Error('Invalid proxy protocol')
  const legacy = raw.match(
    /^(?:(https?|socks5):\/\/)?([^:@/]+):(\d+):([^:]+):(.+)$/,
  )
  if (legacy) {
    return {
      server: `${legacy[1] || scheme}://${legacy[2]}:${legacy[3]}`,
      username: legacy[4],
      password: legacy[5],
    }
  }
  const url = new URL(raw.includes('://') ? raw : `${scheme}://${raw}`)
  if (!['http:', 'https:', 'socks5:'].includes(url.protocol) || !url.hostname)
    throw new Error('Invalid proxy URL')
  return {
    server: `${url.protocol}//${url.host}`,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
  }
}

// Host without credentials for error messages. Never leak proxy login.
export function proxyHostForMessage(
  proxy: { server: string } | undefined,
): string {
  if (!proxy) return ''
  try {
    return new URL(proxy.server).host || proxy.server
  } catch {
    return proxy.server
  }
}

// Cloak resolves the public IP through the proxy for geoip spoofing.
// When that lookup fails the raw error is cryptic, so map it to the
// profile and proxy host that actually failed.
export function describeProxyLaunchError(
  profileName: string,
  proxy: { server: string } | undefined,
  error: unknown,
): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (proxy && /public proxy IP|geoip/i.test(message)) {
    return new Error(
      `Proxy ${proxyHostForMessage(proxy)} for profile "${profileName}" is unreachable: ` +
        `could not detect public IP through it. Check proxy credentials/type or try again.`,
      { cause: error },
    )
  }
  return error instanceof Error ? error : new Error(String(error))
}
