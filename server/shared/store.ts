import { runtimeRequest } from './runtime.js'

export type RuntimeOwnership = {
  manuals: string[]
  automations: Array<{ automationId: string; profiles: string[] }>
  activeProfileNames: string[]
  processCount: number
}
export const runtimeOwnership = (): Promise<RuntimeOwnership> =>
  runtimeRequest('/processes/ownership', { method: 'POST', body: '{}' })
export async function getActiveRuntimeProfileNames(): Promise<string[]> {
  return (await runtimeOwnership()).activeProfileNames
}
