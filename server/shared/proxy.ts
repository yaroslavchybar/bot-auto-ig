export type ProxyType = 'http' | 'https' | 'socks5'
export type ParsedProxy = { server: string; username?: string; password?: string }

// Shared by browser startup, persistence, usage counts, and display helpers.
// An explicit URL scheme takes precedence over the separate protocol field.
export function parseProxy(value: unknown, protocol: unknown = 'http'): ParsedProxy | undefined {
  const raw = String(value ?? '').trim()
  if (!raw || raw.toLowerCase() === 'none') return undefined
  try {
    const scheme = String(protocol || 'http').trim().toLowerCase() || 'http'
    const legacy = raw.match(/^(?:(https?|socks5):\/\/)?(\[[^\]]+\]|[^:@/]+):(\d+):([^:]+):(.+)$/i)
    const url = new URL(legacy
      ? `${legacy[1] || scheme}://${legacy[2]}:${legacy[3]}`
      : raw.includes('://') ? raw : `${scheme}://${raw}`)
    if (!['http:', 'https:', 'socks5:'].includes(url.protocol) || !url.hostname ||
        (url.pathname && url.pathname !== '/') || url.search || url.hash) {
      throw new Error('Invalid proxy URL')
    }
    const port = url.port || ({ 'http:': '80', 'https:': '443', 'socks5:': '1080' }[url.protocol]!)
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid proxy port')
    const defaultPort = { 'http:': '80', 'https:': '443', 'socks5:': '1080' }[url.protocol]
    const host = url.hostname.toLowerCase()
    const username = legacy ? legacy[4] : decodeURIComponent(url.username)
    const password = legacy ? legacy[5] : decodeURIComponent(url.password)
    return {
      server: `${url.protocol}//${host}${port === defaultPort && url.protocol !== 'socks5:' ? '' : `:${Number(port)}`}`,
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
    }
  } catch {
    // URL errors can include the input, which contains credentials.
    throw new Error('Invalid proxy protocol or URL')
  }
}

export function normalizeProxy(value: unknown, protocol?: unknown): { proxy: string; proxyType: ProxyType | '' } {
  const parsed = parseProxy(value, protocol)
  if (!parsed) return { proxy: '', proxyType: '' }
  const separator = parsed.server.indexOf('://')
  const proxyType = parsed.server.slice(0, separator) as ProxyType
  const auth = parsed.username || parsed.password
    ? `${encodeURIComponent(parsed.username ?? '')}:${encodeURIComponent(parsed.password ?? '')}@` : ''
  return { proxy: `${proxyType}://${auth}${parsed.server.slice(separator + 3)}`, proxyType }
}

// Invalid stored rows must not break list rendering. Writes validate separately.
export function proxyKey(value: unknown, protocol?: unknown): string | null {
  try { return normalizeProxy(value, protocol).proxy || null } catch { return null }
}
