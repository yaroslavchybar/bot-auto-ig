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
