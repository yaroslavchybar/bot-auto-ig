import { activeDisplays, type ActiveDisplaySession } from '../shared/store.js'
import { NotFoundError, ValidationError } from '../shared/errors.js'

export function resolveDisplay(vncPortRaw: unknown): ActiveDisplaySession {
  const vncPort = Number(vncPortRaw)
  if (!Number.isSafeInteger(vncPort) || vncPort <= 0 || vncPort > 65535)
    throw new ValidationError('Invalid display port')
  for (const session of activeDisplays.values()) {
    if (session.vncPort === vncPort) return session
  }
  throw new NotFoundError('Display session not found')
}
