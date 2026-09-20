import { parseProxy } from '../../../../../server/shared/proxy'

// Editable inputs only: preserves credentials. Use maskProxyForDisplay in read-only views.
export function formatProxyForInput(value: string | undefined, protocol?: string): string {
  try {
    const parsed = parseProxy(value, protocol)
    if (!parsed) return ''
    const url = new URL(parsed.server)
    const port = url.port || (url.protocol === 'https:' ? '443' : url.protocol === 'socks5:' ? '1080' : '80')
    const host = `${url.hostname}:${port}`
    // These credentials cannot be represented unambiguously in colon format.
    if (parsed.username?.includes(':') || (!parsed.username && parsed.password) || (parsed.username && !parsed.password)) return value ?? ''
    return parsed.username ? `${host}:${parsed.username}:${parsed.password}` : host
  } catch {
    // Preserve invalid input so the user can correct it in the form.
    return value ?? ''
  }
}
