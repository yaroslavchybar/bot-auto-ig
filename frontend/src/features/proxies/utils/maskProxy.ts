import { normalizeProxy, parseProxy } from '../../../../../server/shared/proxy'

export function stripScheme(value: string): string {
  const raw = String(value ?? '').trim()
  return raw.replace(/^[a-z][a-z\d+.-]*:\/\//i, '')
}

// Never fall back to raw input: even malformed values can contain passwords.
export function maskProxyForDisplay(value: string): string {
  try {
    const parsed = parseProxy(value)
    if (!parsed) return ''
    const host = new URL(parsed.server).host
    return parsed.username || parsed.password ? `${host} (•••)` : host
  } catch {
    return 'Invalid proxy (•••)'
  }
}

export function normalizeProxyValue(value: string, proxyType: string): string {
  return normalizeProxy(value, proxyType).proxy
}
