import { runtimeRequest } from '../shared/runtime.js'
import { ValidationError } from '../shared/errors.js'

export type ActiveDisplaySession = {
  id: string
  automationId: string
  profileName: string
  vncPort: number
  displayNum: number
  status: 'active'
  agentActive: boolean
}
export async function resolveDisplay(raw: unknown): Promise<ActiveDisplaySession> {
  const port = Number(raw)
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65535)
    throw new ValidationError('Invalid display port')
  return runtimeRequest('/displays/' + port)
}
