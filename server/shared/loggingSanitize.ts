const PRIVATE_KEYS = /^(password|passwd|secret|token|accessToken|refreshToken|sessionToken|bridgeToken|apiKey|authorization|cookie|cookies|cookiesJson|sessionId|authenticatorKey|privateKey|headers|body|requestBody|responseBody|attachment|content|messageText)$|(?:password|secret|token|apiKey|privateKey|authenticatorKey)$/i

/** Serialize errors explicitly: SDK request/response objects contain credentials. */
export function sanitizeLogValue(value: unknown, secrets: readonly string[] = [], depth = 0, seen = new Set<object>()): unknown {
  if (typeof value === 'string') {
    let text = value
      .replace(/(https?:\/\/|socks5h?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
      .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [redacted]')
      .replace(/\b(sessionid|csrftoken|password|token|api_key|access_token)=([^\s&;,"']+)/gi, '$1=[redacted]')
      .replace(/(["'](?:password|token|api_key|access_token|sessionid|csrftoken|authorization|cookie)["']\s*:\s*)["'][^"']*["']/gi, '$1"[redacted]"')
    for (const secret of secrets) if (secret.length >= 4) text = text.split(secret).join('[redacted]')
    return text.slice(0, 4000)
  }
  if (value == null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return String(value)
  if (typeof value !== 'object') return undefined
  if (seen.has(value)) return '[circular]'
  if (depth >= 6) return '[truncated]'
  seen.add(value)
  try {
    if (value instanceof Error) {
      const error = value as Error & { code?: unknown }
      // Body parser messages can quote malformed request bytes, including credentials.
      if (error instanceof SyntaxError && 'body' in error)
        return { type: 'SyntaxError', message: 'Invalid request JSON' }
      return {
        type: sanitizeLogValue(error.name, secrets),
        message: sanitizeLogValue(error.message, secrets),
        ...(typeof error.code === 'string' ? { code: sanitizeLogValue(error.code, secrets) } : {}),
        ...(error.stack ? { stack: sanitizeLogValue(error.stack, secrets) } : {}),
      }
    }
    if (Array.isArray(value)) return value.slice(0, 30).map(item => sanitizeLogValue(item, secrets, depth + 1, seen))
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [
      key, PRIVATE_KEYS.test(key.replace(/[_-]/g, '')) ? '[redacted]' : sanitizeLogValue(item, secrets, depth + 1, seen),
    ]))
  } finally { seen.delete(value) }
}
