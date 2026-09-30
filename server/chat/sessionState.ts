import { createHash } from 'node:crypto'

/** Cookie access timestamps change on reads; they do not change the usable login session. */
export function sessionStateHash(serialized: string): string {
  const state = JSON.parse(serialized) as Record<string, unknown>
  if (typeof state.cookies === 'string') {
    const jar = JSON.parse(state.cookies) as { cookies?: Record<string, unknown>[] }
    for (const cookie of jar.cookies ?? []) {
      delete cookie.lastAccessed
      // Absolute expiry is preserved; creation matters only for relative max-age cookies.
      if (cookie.maxAge === undefined || cookie.maxAge === null) delete cookie.creation
    }
    state.cookies = jar
  }
  return createHash('sha256').update(JSON.stringify(state)).digest('hex')
}
