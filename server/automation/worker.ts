import type { WorkerEvent } from '../shared/contracts.js'
import {
  openBrowserSession,
  type BrowserSession,
} from '../browser/cloak.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shouldStop, shutdownSignal, requestStop, releaseStdin } from '../browser/lifecycle.js'
import {
  type DbProfileRow,
  type DbAutomationRow,
} from '../shared/convexClient.js'
import {
  closeConvexRealtime,
  watchRoutineAccess,
  watchRoutineRuntime,
  type RuntimeSnapshot,
} from '../shared/convexRealtime.js'
import { prepareBrowsingDay } from './sessions.js'
import { runRoutineSession } from './routine.js'
import { withAiSettings } from './ai-settings.js'
import { postModelUpdateInSession } from '../ig-accounts/warmup.js'
import { setupModelInSession } from '../ig-accounts/profile-setup.js'
import { routineReady, routineRecordSession } from '../shared/convexClient.js'
import { orderProfileQueue } from './profile-queue.js'
import logger, { logOperation, addLogContext, currentLogScope, type LogScope } from '../shared/logger.js'
import type { ActionLogger } from './actions/shared.js'
import { captureConsole } from '../logs/console.js'
import { attachSessionDecisions } from './actions/session-decision.js'
import { observeAutomationUi } from './actions/observe-ui.js'
import { routineDueAt, loadFullRuntimeSnapshot } from './readiness.js'
export { loadFullRuntimeSnapshot } from './readiness.js'

type AnyRecord = Record<string, any>
const log: ActionLogger = fields => fields.outcome === 'error' ? logger.error(fields) : logger.info(fields)

function event(type: WorkerEvent['type'], data: AnyRecord = {}): Promise<void> {
  return new Promise((resolve, reject) => process.stdout.write(
    `__EVENT__${JSON.stringify({ type, ts: new Date().toISOString(), ...data })}__EVENT__\n`,
    error => error ? reject(error) : resolve(),
  ))
}

function isTruncatedSnapshot(snapshot: RuntimeSnapshot): boolean {
  return !!snapshot && !!snapshot.truncated
}

/** Local prefilter; the server still authorizes each session and DM. */
export function routineMayRun(snapshot: RuntimeSnapshot, profileId: string, now = Date.now()): boolean {
  if (snapshot?.profiles?.find(profile => profile.id === profileId)?.paused) return false
  const state = snapshot?.progress?.find(row => row.profileId === profileId)
  const warmup = snapshot?.warmups?.find(row => row.profileId === profileId)
  if (state?.issue || (state?.nextRunAt ?? 0) > now || (warmup?.nextRunAt ?? 0) > now) return false
  if (warmup?.date === new Date(now).toISOString().slice(0, 10)) {
    if (warmup.activeRun || (warmup.minutesUsedToday ?? 0) >= (warmup.todayMinutes ?? Infinity)) return false
  }
  return true
}

function profileEligible(profile: DbProfileRow, models: string[]): boolean {
  return !profile.paused && !profile.inUse && profile.status !== 'running' &&
    !!profile.modelId && models.includes(profile.modelId)
}

async function expandedRuntimeSnapshot(
  automationId: string,
  lists: string[],
  snapshot: RuntimeSnapshot,
): Promise<RuntimeSnapshot> {
  if (!isTruncatedSnapshot(snapshot)) return snapshot
  try {
    return await loadFullRuntimeSnapshot(automationId, lists, snapshot)
  } catch (error) {
    log({ event: 'automation.worker.full_runtime_sweep_failed', automationId, error, outcome: 'error' })
    return snapshot
  }
}

/** Owns the live runtime snapshot and detects configuration changes. */
class RuntimeMonitor {
  private readonly subscription: ReturnType<typeof watchRoutineRuntime>
  private initialized = false
  snapshot: RuntimeSnapshot | null = null
  error?: Error

  constructor(automationId: string, lists: string[], watch = watchRoutineRuntime) {
    this.subscription = watch(
      automationId, lists,
      snapshot => this.onSnapshot(snapshot),
      error => {
        this.error = error
        log({ event: 'automation.worker.runtime_subscription_failed', automationId, error, outcome: 'error' })
      },
      shutdownSignal,
    )
  }

  get initial() { return this.subscription.initial }

  private onSnapshot(snapshot: RuntimeSnapshot): void {
    const configRevision = String(snapshot?.automation?.configRevision ?? '')
    const previousConfigRevision = String(this.snapshot?.automation?.configRevision ?? '')
    if (this.initialized && configRevision !== previousConfigRevision)
      this.error = new Error('Automation configuration changed; restarting worker')
    this.snapshot = snapshot
    this.initialized = true
  }

  isActive(): boolean {
    const automation = this.snapshot?.automation
    return !this.error && !!automation &&
      (automation.status === 'running' || automation.status === 'pending') &&
      automation.isActive !== false
  }

  stop(): void { this.subscription.unsubscribe() }
}

async function withProfile(
  profile: DbProfileRow,
  options: {
    headless?: boolean
    automationId?: string
    openSession?: typeof openBrowserSession
  } = {},
  run: (session: BrowserSession) => Promise<void>,
): Promise<void> {
  const parent = currentLogScope()
  let profileScope: LogScope | undefined
  return logOperation('automation.profile_session', { profileId: profile.id, profileName: profile.name, automationId: options.automationId, headless: options.headless ?? true }, async scope => {
    profileScope = scope
    const automationId = options.automationId || 'automation'
    let session: BrowserSession | undefined
    let closing: Promise<void> | undefined
    let failure: unknown
    let detachDecisions = () => {}
    let stopUiDiagnostics = () => {}
    const close = () => session ? (closing ??= Promise.resolve().then(() => session!.close())) : Promise.resolve()
    try {
      session = await (options.openSession ?? openBrowserSession)(profile.name, {
        headless: options.headless ?? true,
      })
      stopUiDiagnostics = observeAutomationUi(session.page, shouldStop)
      await event('profile_started', {
        profileName: profile.name,
        profileId: profile.id,
        automationId: automationId,
      })
      addLogContext({ displayNum: session.display?.displayNum, vncPort: session.display?.vncPort })
      if (session.display) {
        const display = session.display
        detachDecisions = attachSessionDecisions(session.page, decision => {
          void event('session_decision', { automationId, profileName: profile.name,
            displayId: display.id, decision }).catch(() => {})
        })
      }
      await run(session)
      await close()
      if (shouldStop()) addLogContext({ outcome: 'cancelled' })
      await event('profile_completed', {
        profileName: profile.name,
        profileId: profile.id,
        automationId: automationId,
      })
    } catch (error) {
      failure = error
      const message = error instanceof Error ? error.message : String(error)
      if (shouldStop()) addLogContext({ outcome: 'cancelled' })
      else log({ event: 'automation.profile_error', error, outcome: 'error' })
      await event('error', {
        profileName: profile.name,
        profileId: profile.id,
        automationId: automationId,
        error: message,
      })
      throw error
    } finally {
      detachDecisions()
      await close().catch(error => {
        if (error !== failure) log({ event: 'automation.profile_cleanup_failed', error, outcome: 'error' })
      })
      stopUiDiagnostics()
    }

  }).finally(() => {
    if (profileScope?.failed) parent?.note('error', { event: 'automation.profile_failed', ...profileScope.safeFields({
      profileId: profile.id, profileName: profile.name,
      childOperationId: profileScope.operationId, reason: profileScope.fields.sessionReason,
      error: profileScope.error ?? new Error(`Profile session failed: ${String(profileScope.fields.sessionReason || 'unknown reason')}`),
    }) })
  })
}

const workerDependencies = {
  openSession: openBrowserSession,
  runSession: runRoutineSession,
  watchRuntime: watchRoutineRuntime,
  watchRoutineAccess,
  setupModel: setupModelInSession,
  postModelUpdate: postModelUpdateInSession,
}
export type WorkerDependencies = typeof workerDependencies

async function runRoutineProfile(options: {
  profile: DbProfileRow
  automation: DbAutomationRow
  routine: NonNullable<DbAutomationRow['routine']>
  automationId: string
  deps: WorkerDependencies
}): Promise<void> {
  const { profile, automation, routine, automationId, deps } = options
  let access = true
  const accessController = new AbortController()
  const setupSignal = AbortSignal.any([shutdownSignal, accessController.signal])
  const accessSubscription = deps.watchRoutineAccess(
    automationId, profile.id,
    value => { access = value; if (!value) accessController.abort(new Error('Routine access revoked')) },
    error => {
      access = false
      accessController.abort(error)
      log({ event: 'automation.worker.routine_access_subscription_failed', automationId, profileId: profile.id, error, outcome: 'error' })
    },
    shutdownSignal,
  )
  try {
    access = await accessSubscription.initial
    if (!access || !await routineReady(automationId, profile.id, false)) return
    if (!await prepareBrowsingDay(profile.id, routine.activity ?? {})) return
    let hadActivity = false
    await withProfile(profile, { headless: routine.headless, openSession: deps.openSession, automationId }, async session => {
      hadActivity = await withAiSettings(routine.ai,
        () => deps.runSession(automation, profile.id, session.page, log, shouldStop, undefined, () => access)) === true
      const modelId = automation.modelIds?.length === 1 ? automation.modelIds[0] : undefined
      if (modelId && !shouldStop() && access) {
        hadActivity = await deps.setupModel(profile.id, automationId, session.page, log,
          () => shouldStop() || !access, setupSignal).catch(() => false) || hadActivity
      }
      if (modelId && !shouldStop() && access) {
        hadActivity = await deps.postModelUpdate(profile.id, modelId, session.page, log,
          () => shouldStop() || !access, setupSignal).catch(() => false) || hadActivity
      }
    })
    if (hadActivity && !shouldStop() && access) {
      await event('model_setup_after_session', { profileId: profile.id })
    }
  } catch (error) {
    if (shouldStop()) throw error
    if (!access) return
    await routineRecordSession(automationId, profile.id, false, error instanceof Error ? error.message : String(error))
  } finally {
    accessSubscription.unsubscribe()
  }
}

export async function runAutomation(
  input: AnyRecord,
  overrides: Partial<WorkerDependencies> = {},
): Promise<void> {
  const deps = { ...workerDependencies, ...overrides }
  const automation = (input.automation || {}) as DbAutomationRow & AnyRecord
  const automationId = String(input.automationId || 'automation')
  if (!automation.routine) throw new Error('Routine settings are required')
  const lists = automation.modelIds ?? []
  if (!lists.length)
    throw new Error(
      'Select at least one profile list before running the automation',
    )
  const monitor = new RuntimeMonitor(automationId, lists.map(String), deps.watchRuntime)
  try {
    const runtime = await monitor.initial
    if (!runtime) throw new Error('Automation runtime not found')
    let latestRuntime: RuntimeSnapshot = runtime
    if (isTruncatedSnapshot(latestRuntime)) {
      latestRuntime = await expandedRuntimeSnapshot(automationId, lists, latestRuntime)
      if (latestRuntime && !isTruncatedSnapshot(latestRuntime)) {
        log({ event: 'automation.runtime_snapshot_swept', message: `runtime snapshot truncated; swept ${latestRuntime.profiles.length} profiles across windows`, profileCount: latestRuntime.profiles.length })
      }
    }
    const profiles = (latestRuntime?.profiles ?? []).filter(profile => profileEligible(profile as DbProfileRow, lists)) as DbProfileRow[]

    await event('session_started', { automationId: automationId })
    if (!profiles.length)
      log({ event: 'automation.worker.available_profiles_in_the_selected', message: 'No available profiles in the selected lists; returning to scheduler' })

    // Rust schedules the next worker after this ready queue is drained.
    const ready = profiles.filter(profile => routineMayRun(latestRuntime, profile.id))
    for (const profile of orderProfileQueue(ready)) {
      shutdownSignal.throwIfAborted()
      if (!monitor.isActive()) break
      await runRoutineProfile({ profile, automation, routine: automation.routine!, automationId, deps })
    }

    if (monitor.isActive()) {
      const snapshot = await expandedRuntimeSnapshot(automationId, lists, monitor.snapshot)
      await event('worker_waiting', { automationId, dueAt: Math.max(Date.now() + 1000, routineDueAt(snapshot)) })
      return
    }
    if (monitor.error) throw monitor.error

    await event('session_ended', {
      automationId: automationId,
      status: 'completed',
    })
  } finally {
    monitor.stop()
  }
}

/**
 * One JSON payload on the first stdin line, then an open channel: later
 * `stop` lines abort the run through the lifecycle, exactly like SIGTERM.
 * (Signals don't reach detached children on Windows, stdin always does.)
 */
function readCommandInput(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let pending = ''
    let settled = false
    const onData = (chunk: unknown) => {
      pending += String(chunk)
      let index: number
      while ((index = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, index).trim()
        pending = pending.slice(index + 1)
        if (!line) continue
        if (!settled) {
          settled = true
          resolve(line)
        } else if (line === 'stop') {
          requestStop()
        }
      }
    }
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', onData)
    process.stdin.once('end', () => {
      if (settled) return
      settled = true
      if (pending.trim()) resolve(pending.trim())
      else reject(new Error('No automation input received on stdin'))
    })
    process.stdin.once('error', (error) => {
      if (!settled) {
        settled = true
        reject(error)
      }
    })
  })
}

async function main(): Promise<void> {
  captureConsole()
  return logOperation('automation.session', {}, async () => {
    const input = JSON.parse(await readCommandInput()) as AnyRecord
    if (!input.automation) throw new Error('automation is required')
    addLogContext({ automationId: input.automationId || input.automation._id })
    try {
      await runAutomation(input)
    } finally {
      releaseStdin()
      if (shouldStop()) addLogContext({ outcome: 'cancelled' })
      await closeConvexRealtime()
    }

  })
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error)
    await event('session_ended', {
      status: shouldStop() ? 'cancelled' : 'failed',
      error: message,
    }).catch(() => undefined)
    process.exitCode = shouldStop() ? 0 : 1
  })
