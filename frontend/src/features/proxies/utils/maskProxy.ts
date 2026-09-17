// Display helpers for proxy values. Stored values look like
// "http://host:port:user:pass" or "host:port:user:pass".
// Never render credentials in the list view.

export function stripScheme(value: string): string {
  const raw = String(value ?? '').trim()
  const idx = raw.indexOf('://')
  return idx >= 0 ? raw.slice(idx + 3) : raw
}

export function maskProxyForDisplay(value: string): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  // URL form with credentials: scheme://user:pass@host:port
  if (raw.includes('@')) {
    try {
      const url = new URL(raw.includes('://') ? raw : `http://${raw}`)
      if (url.username || url.password) {
        return `${url.host} (${url.username || 'user'}:•••)`
      }
      return url.host || stripScheme(raw)
    } catch {
      return stripScheme(raw)
    }
  }
  // Legacy form: host:port:user:pass or host:port
  const bare = stripScheme(raw)
  const parts = bare.split(':')
  if (parts.length >= 4) {
    return `${parts[0]}:${parts[1]}:${parts[2]}:•••`
  }
  if (parts.length === 3) {
    return `${parts[0]}:${parts[1]}:•••`
  }
  return bare
}

// Normalize to "type://rest" so saved proxies match the format
// profiles already store (see ProfileForm handleSave).
export function normalizeProxyValue(value: string, proxyType: string): string {
  const type = String(proxyType || 'http').trim().toLowerCase() || 'http'
  const rest = stripScheme(String(value || '').trim())
  return `${type}://${rest}`
}
