import { automationMutex, automationWorkers, runAutomation, stopAutomations, onWorkerClosed } from './service.js'
import { closeConvexRealtime, watchActiveRoutines, watchRoutineRuntime, type RuntimeSnapshot } from '../shared/convexRealtime.js'
import { runtimeRequest } from '../shared/runtime.js'
import { routineDueAt, loadFullRuntimeSnapshot } from '../automation/readiness.js'
import logger from '../shared/logger.js'
import { latestQueue } from '../shared/latest-queue.js'

type Routine = { _id: string; hasRoutine?: boolean; isActive?: boolean; listIds?: string[]; configRevision?: string }
type Watcher = { row: Routine; snapshot: RuntimeSnapshot; dueAt?: number; scheduledAt?: number; ready: boolean; unsubscribe: () => void; update: () => Promise<void> }

/** The API watches lightweight state; Rust owns wakeups while browser workers exit between runs. */
export function startRoutineScheduler() {
  let stopped = false
  const controller = new AbortController()
  const watchers = new Map<string, Watcher>()
  const maxConcurrency = () => Math.max(1, Number(process.env.AUTOMATION_MAX_CONCURRENCY) || 3)
  const schedule = async (watcher: Watcher) => {
    const id = watcher.row._id
    if (watchers.get(id) !== watcher) return
    if (stopped || !watcher.row.isActive || !watcher.ready || automationWorkers.has(id)) {
      await runtimeRequest(`/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' })
      return
    }
    const snapshot = watcher.snapshot?.truncated
      ? await loadFullRuntimeSnapshot(id, watcher.row.listIds ?? [], watcher.snapshot) : watcher.snapshot
    if (stopped || watchers.get(id) !== watcher || automationWorkers.has(id)) return
    const dueAt = Math.min(Math.max(routineDueAt(snapshot), watcher.dueAt ?? 0), watcher.scheduledAt ?? Infinity)
    await runtimeRequest(`/schedules/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ dueAt }) })
    watcher.scheduledAt = dueAt
  }
  const error = (err: unknown) => logger.error({ event: 'automations.scheduler.failed', error: err, outcome: 'error' })
  const subscription = watchActiveRoutines(next => {
    const rows = next as Routine[]
    const enabled = new Set(rows.filter(row => row.hasRoutine && row.isActive).map(row => row._id))
    for (const [id, watcher] of watchers) {
      if (enabled.has(id)) continue
      watcher.unsubscribe()
      watchers.delete(id)
      void runtimeRequest(`/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(error)
      if (automationWorkers.has(id)) void (async () => {
        const release = await automationMutex.acquire()
        try { await stopAutomations(id) } finally { release() }
      })().catch(error)
    }
    for (const row of rows) {
      if (!enabled.has(row._id)) continue
      const existing = watchers.get(row._id)
      if (existing && existing.row.configRevision === row.configRevision) continue
      existing?.unsubscribe()
      const watcher: Watcher = { row, snapshot: null, ready: false, unsubscribe: () => {}, update: async () => {} }
      const updates = latestQueue<void>(async () => { try { await schedule(watcher) } catch (err) { error(err) } })
      watcher.update = () => updates.push(undefined)
      watchers.set(row._id, watcher)
      const runtime = watchRoutineRuntime(row._id, row.listIds ?? [], snapshot => {
        watcher.snapshot = snapshot
        watcher.ready = true
        // Database changes can make a sleeping profile runnable sooner.
        watcher.dueAt = undefined
        watcher.scheduledAt = undefined
        void watcher.update()
      }, err => { watcher.ready = false; void watcher.update(); error(err) })
      watcher.unsubscribe = runtime.unsubscribe
      void runtime.initial.catch(() => undefined)
    }
  }, error)
  void subscription.initial.catch(error)
  const unwatchClosed = onWorkerClosed((id, dueAt) => {
    const watcher = watchers.get(id)
    if (!watcher) return
    watcher.dueAt = dueAt
    watcher.scheduledAt = undefined
    void watcher.update()
  })
  const poll = async () => {
    while (!stopped) {
      try {
        const ids = await runtimeRequest<string[]>('/schedules/due', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) })
        if (!ids.length) for (const watcher of watchers.values()) void watcher.update()
        for (const id of ids) {
          const watcher = watchers.get(id)
          if (!watcher || !watcher.row.isActive || automationWorkers.has(id)) continue
          watcher.scheduledAt = undefined
          const release = await automationMutex.acquire()
          try {
            if (stopped) break
            if (automationWorkers.has(id)) continue
            if (automationWorkers.size >= maxConcurrency()) {
              watcher.dueAt = Date.now() + 1000
              await watcher.update()
              continue
            }
            await runAutomation({ automationId: id })
          } catch (err) {
            error(err)
            watcher.dueAt = Date.now() + 5000
            await watcher.update()
          } finally { release() }
        }
      } catch (err) {
        if (stopped) break
        error(err)
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve() }
          const timer = setTimeout(done, 1000)
          controller.signal.addEventListener('abort', done, { once: true })
          if (controller.signal.aborted) done()
        })
        // Restore deadlines after a native helper restart or a failed update.
        for (const watcher of watchers.values()) void watcher.update()
      }
    }
  }
  void poll()
  return () => {
    stopped = true
    controller.abort()
    unwatchClosed()
    subscription.unsubscribe()
    for (const watcher of watchers.values()) watcher.unsubscribe()
    watchers.clear()
    void closeConvexRealtime()
  }
}
