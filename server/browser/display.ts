import { nativeLease } from '../shared/runtimeSockets.js'
import { shutdownSignal, requestStop } from './lifecycle.js'

export type Display = {
  id: string
  display: string
  displayNum: number
  vncPort: number
  close: () => Promise<void>
}

export async function allocateDisplay(profileName: string): Promise<Display | undefined> {
  if (process.platform !== 'linux') return undefined
  const lease = await nativeLease<{ display: { id: string; displayNum: number; vncPort: number } }>(
    '/displays/lease',
    {
      profileName,
      automationId: process.env.LOG_AUTOMATION_ID || 'manual',
    },
    shutdownSignal,
    () => requestStop(),
  )
  return {
    id: lease.value.display.id,
    display: ':' + lease.value.display.displayNum,
    displayNum: lease.value.display.displayNum,
    vncPort: lease.value.display.vncPort,
    close: async () => lease.release(),
  }
}
