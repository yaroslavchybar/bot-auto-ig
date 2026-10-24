// Test transport only: production orchestration still receives normal subscriptions.
import {
  automationsGetById,
  profilesList,
  warmupGetByProfile,
} from '../../server/shared/convexClient.js'
import { runAutomation, type WorkerDependencies } from '../../server/automation/worker.js'
import type { RuntimeSnapshot } from '../../server/shared/convexRealtime.js'

const intervalMs = 5

export function runTestAutomation(
  input: Record<string, any>,
  openSession: WorkerDependencies['openSession'],
) {
  const allowed = (_id: string, update: (value: boolean) => void) => {
    update(true)
    return { initial: Promise.resolve(true), unsubscribe() {} }
  }
  return runAutomation(input, {
    openSession,
    setupModel: async () => false,
    postModelUpdate: async () => false,
    watchRoutineAccess: (_automation, id, update) => allowed(id, update),
    watchRuntime: (id, _lists, update) => {
      let stopped = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const snapshot = async (automation: Record<string, any>): Promise<RuntimeSnapshot> => {
        const profiles = await profilesList()
        const warmups = (
          await Promise.all(
            profiles.map(async (p) => {
              const state = await warmupGetByProfile(p.id)
              return state ? { ...state, profileId: p.id } : null
            }),
          )
        ).filter((row) => row !== null)
        return { automation, profiles, warmups }
      }
      const tick = async () => {
        if (stopped) return
        try {
          const automation = await automationsGetById(id)
          const active = automation && ['running', 'pending'].includes(automation.status)
          const value = active
            ? await snapshot(automation)
            : { automation: { isActive: false }, profiles: [] }
          if (!stopped) update(value)
          if (!stopped && active) timer = setTimeout(tick, intervalMs)
        } catch {
          if (!stopped) update({ automation: { isActive: false }, profiles: [] })
        }
      }
      const initial = snapshot({ isActive: true, status: 'running' }).then((value) => {
        if (!stopped) {
          update(value)
          timer = setTimeout(tick, intervalMs)
        }
        return value
      })
      return {
        initial,
        unsubscribe() {
          stopped = true
          clearTimeout(timer)
        },
      }
    },
  })
}
