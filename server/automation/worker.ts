import type { WorkerEvent } from '../shared/contracts.js'
import {
  openBrowserSession,
  type BrowserSession,
} from '../browser/cloak.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sleep, shouldStop, shutdownSignal, requestStop, releaseStdin } from '../browser/lifecycle.js'
import {
  automationsGetById,
  automationsRuntimePage,
  profilesList,
  profilesSyncStatus,
  warmupGetByProfile,
  type DbProfileRow,
  type DbAutomationRow,
} from '../shared/convexClient.js'
import {
  closeConvexRealtime,
  watchRoutineAccess,
  watchRoutineRuntime,
  type RuntimeSnapshot,
  type RuntimeWarmup,
  type RuntimeProgress,
} from '../shared/convexRealtime.js'
import { runWarmup, warmupReady } from './warmup.js'
import { runRoutineSession } from './routine.js'
import { routineReady, routineRecordSession } from '../shared/convexClient.js'
import { runPool } from './pool.js'
import { orderProfileQueue, profileProxyKey } from './profile-queue.js'
import {
  selectedLists,
  startConfig,
  profileEligible,
  type AutomationNode,
  type AutomationEdge,
} from './graph.js'
import { executeGraphProfile } from './graph-runner.js'

type AnyRecord = Record<string, any>
type LogLevel = 'info' | 'warn' | 'error' | 'success'

function log(message: string, level: LogLevel = 'info'): void {
  process.stdout.write(
    `[${new Date().toISOString()}] ${level.toUpperCase()}: ${message}\n`,
  )
}

function event(type: WorkerEvent['type'], data: AnyRecord = {}): Promise<void> {
  return new Promise((resolve, reject) => process.stdout.write(
    `__EVENT__${JSON.stringify({ type, ts: new Date().toISOString(), ...data })}__EVENT__\n`,
    error => error ? reject(error) : resolve(),
  ))
}

function number(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

// Kept for the injected test runner. Production workers use Convex subscriptions.
let profilePollIntervalMs = 5 * 60 * 1000

/** Override the poll interval (tests). */
export function setProfilePollIntervalMs(ms: number): void {
  profilePollIntervalMs = ms
}

/** Safety cap so a missed subscription update never sleeps forever. */
export const MAX_REALTIME_SLEEP_MS = 15 * 60 * 1000

export function msUntilMidnightUtc(now = Date.now()): number {
  const date = new Date(now)
  const nextMidnight = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1,
  )
  return Math.max(0, nextMidnight - now)
}

/**
 * How long the realtime loop may sleep before a time-based readiness change.
 * Covers profile reopen cooldown, warmup/account rest periods, and UTC day
 * rollover (daily budgets reset). Same logic for routine and warmup paths.
 */
export function nextWakeupDelayMs(
  snapshot: RuntimeSnapshot | null,
  cooldownMinutes: number,
  now = Date.now(),
): number {
  const candidates: number[] = [msUntilMidnightUtc(now)]
  for (const profile of snapshot?.profiles ?? []) {
    const lastOpened = Number((profile as AnyRecord).lastOpenedAt)
    if (cooldownMinutes > 0 && Number.isFinite(lastOpened) && lastOpened > 0) {
      const expiry = lastOpened + cooldownMinutes * 60_000
      if (expiry > now) candidates.push(expiry - now)
    }
  }
  for (const row of snapshot?.warmups ?? []) {
    const at = Number((row as AnyRecord).nextRunAt)
    if (Number.isFinite(at) && at > now) candidates.push(at - now)
  }
  for (const row of snapshot?.progress ?? []) {
    const at = Number((row as AnyRecord).nextRunAt)
    if (Number.isFinite(at) && at > now) candidates.push(at - now)
  }
  return Math.max(0, Math.min(...candidates, MAX_REALTIME_SLEEP_MS))
}

function isTruncatedSnapshot(snapshot: RuntimeSnapshot): boolean {
  return !!snapshot && !!snapshot.truncated
}

/** Local prefilter; the server still authorizes each session and DM. */
export function routineMayRun(snapshot: RuntimeSnapshot, profileId: string, now = Date.now()): boolean {
  const state = snapshot?.progress?.find(row => row.profileId === profileId)
  const warmup = snapshot?.warmups?.find(row => row.profileId === profileId)
  if (state?.paused || state?.issue || (state?.nextRunAt ?? 0) > now || (warmup?.nextRunAt ?? 0) > now) return false
  if (warmup?.date === new Date(now).toISOString().slice(0, 10)) {
    if (warmup.activeRun || (warmup.minutesUsedToday ?? 0) >= (warmup.todayMinutes ?? Infinity)) return false
  }
  return true
}

/**
 * Sweep every list with keyset cursor pages so profiles outside the first
 * window still enter the queue. Each page performs one bounded index read,
 * so a full sweep costs O(N) reads. Profiles in several lists merge once.
 * Exported for tests.
 */
export async function loadFullRuntimeSnapshot(
  automationId: string,
  listIds: string[],
  first: RuntimeSnapshot,
): Promise<NonNullable<RuntimeSnapshot>> {
  const base = first ?? { automation: {}, profiles: [] }
  const seen = new Map<string, Record<string, any>>()
  const warmups = new Map<string, RuntimeWarmup>()
  const progress = new Map<string, RuntimeProgress>()
  for (const profile of base.profiles ?? []) seen.set(String((profile as AnyRecord).id), profile as Record<string, any>)
  for (const row of base.warmups ?? []) warmups.set(String(row.profileId), row)
  for (const row of base.progress ?? []) progress.set(String(row.profileId), row)
  for (const listId of listIds.map(String)) {
    let cursor: string | null | undefined = null
    let guard = 0
    while (guard++ < 500) {
      const page = await automationsRuntimePage(automationId, listId, cursor ?? undefined)
      if (!page) break
      for (const profile of page.profiles ?? []) {
        const id = String((profile as AnyRecord).id ?? (profile as AnyRecord)._id ?? '')
        if (id && !seen.has(id)) seen.set(id, profile as Record<string, any>)
      }
      for (const row of page.warmups ?? []) {
        const id = String(row.profileId)
        if (id && !warmups.has(id)) warmups.set(id, row)
      }
      for (const row of page.progress ?? []) {
        const id = String(row.profileId)
        if (id && !progress.has(id)) progress.set(id, row)
      }
      if (page.isDone || !page.nextCursor) break
      cursor = page.nextCursor
    }
  }
  return {
    automation: base.automation,
    profiles: [...seen.values()],
    warmups: [...warmups.values()],
    progress: [...progress.values()],
    truncated: false,
  }
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
    log(`full runtime sweep failed: ${error instanceof Error ? error.message : String(error)}`, 'warn')
    return snapshot
  }
}

// Kept for the injected test runner. Production workers receive this state
// through the reactive runtime subscription below.
async function shouldKeepWatching(automationId: string): Promise<boolean> {
  try {
    const row = await automationsGetById(automationId)
    // The parent's session_started update may still be in flight on the first check.
    return !!row && (row.status === 'running' || row.status === 'pending') && row.isActive !== false
  } catch {
    return false
  }
}

class UpdateSignal {
  private pending = 0
  private waiter: (() => void) | null = null

  notify(): void {
    this.pending = 1
    const waiter = this.waiter
    this.waiter = null
    waiter?.()
  }

  wait(abortSignal: AbortSignal, timeoutMs?: number): Promise<boolean> {
    if (this.pending > 0) {
      this.pending--
      return Promise.resolve(true)
    }
    if (abortSignal.aborted) return Promise.resolve(false)
    return new Promise(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const cleanup = () => {
        if (timer) clearTimeout(timer)
        abortSignal.removeEventListener('abort', onAbort)
      }
      const onAbort = () => {
        this.waiter = null
        cleanup()
        resolve(false)
      }
      const onWake = (value: boolean) => {
        cleanup()
        resolve(value)
      }
      this.waiter = () => {
        this.pending = Math.max(0, this.pending - 1)
        onWake(true)
      }
      abortSignal.addEventListener('abort', onAbort, { once: true })
      if (Number.isFinite(timeoutMs) && (timeoutMs as number) >= 0) {
        timer = setTimeout(() => {
          if (this.waiter) {
            this.waiter = null
            onWake(true)
          }
        }, timeoutMs)
        timer.unref?.()
      }
    })
  }
}

/** Owns the live runtime subscription and its wakeup signal. */
class RuntimeMonitor {
  private readonly updates = new UpdateSignal()
  private readonly subscription: ReturnType<typeof watchRoutineRuntime>
  private initialized = false
  private profileRevision = ''
  private automationRevision = ''
  private timingRevision = ''
  snapshot: RuntimeSnapshot | null = null
  error?: Error

  constructor(automationId: string, lists: string[]) {
    this.subscription = watchRoutineRuntime(
      automationId, lists,
      snapshot => this.onSnapshot(snapshot),
      error => {
        this.error = error
        log(`runtime subscription failed: ${error.message}`, 'warn')
        this.updates.notify()
      },
    )
  }

  get initial() { return this.subscription.initial }

  private onSnapshot(snapshot: RuntimeSnapshot): void {
    const profileRevision = JSON.stringify((snapshot?.profiles ?? []).map(profile => ({
      id: profile.id, name: profile.name, status: profile.status,
      using: profile.using, igLoggedIn: profile.igLoggedIn,
      outreachReady: profile.outreachReady, listIds: profile.listIds,
      lastOpenedAt: profile.lastOpenedAt, renameFrom: profile.renameFrom,
    })))
    const timingRevision = JSON.stringify({
      warmups: snapshot?.warmups ?? [], progress: snapshot?.progress ?? [],
    })
    const automationRevision = `${snapshot?.automation?.status ?? ''}:${snapshot?.automation?.isActive !== false}`
    const configRevision = String(snapshot?.automation?.configRevision ?? '')
    const previousConfigRevision = String((this.snapshot?.automation as AnyRecord | undefined)?.configRevision ?? '')
    const configChanged = this.initialized && configRevision !== previousConfigRevision
    const changed = this.initialized && (
      profileRevision !== this.profileRevision ||
      timingRevision !== this.timingRevision ||
      automationRevision !== this.automationRevision || configChanged
    )
    if (configChanged) this.error = new Error('Automation configuration changed; restarting worker')
    this.snapshot = snapshot
    this.profileRevision = profileRevision
    this.timingRevision = timingRevision
    this.automationRevision = automationRevision
    if (changed) this.updates.notify()
    this.initialized = true
  }

  isActive(): boolean {
    const automation = this.snapshot?.automation
    return !this.error && !!automation &&
      (automation.status === 'running' || automation.status === 'pending') &&
      automation.isActive !== false
  }

  wait(timeoutMs: number): Promise<boolean> {
    return this.updates.wait(shutdownSignal, timeoutMs)
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
  run: (session: BrowserSession, controls: {
    close: () => Promise<void>
  }) => Promise<void>,
): Promise<void> {
  const automationId = options.automationId || 'automation'
  let session: BrowserSession | undefined
  let closed = false
  let markedRunning = false
  const close = async () => {
    if (!session || closed) return
    await session.close()
    closed = true
    if (session.display) await event('display_released', { automationId: automationId, profileName: profile.name })
  }
  try {
    session = await (options.openSession ?? openBrowserSession)(profile.name, {
      headless: options.headless ?? true,
    })
    await profilesSyncStatus(profile.name, 'running', true)
    markedRunning = true
    await event('profile_started', {
      profileName: profile.name,
      profileId: profile.id,
      automationId: automationId,
    })
    if (session.display)
      await event('display_allocated', {
        automationId: automationId,
        profileName: profile.name,
        displayNum: session.display.displayNum,
        vncPort: session.display.vncPort,
      })
    await run(session, { close })
    await event('profile_completed', {
      profileName: profile.name,
      profileId: profile.id,
      automationId: automationId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log(`${profile.name}: ${message}`, 'error')
    await event('error', {
      profileName: profile.name,
      profileId: profile.id,
      automationId: automationId,
      error: message,
    })
    throw error
  } finally {
    await close().catch(() => undefined)
    if (markedRunning)
      await profilesSyncStatus(profile.name, 'idle', false).catch(
        () => undefined,
      )
  }
}

async function runRoutineProfile(options: {
  profile: DbProfileRow
  automation: DbAutomationRow
  routine: NonNullable<DbAutomationRow['routine']>
  automationId: string
  openSession: typeof openBrowserSession
  useRealtime: boolean
}): Promise<void> {
  const { profile, automation, routine, automationId, openSession, useRealtime } = options
  let access = true
  const accessSubscription = useRealtime
    ? watchRoutineAccess(
        automationId, profile.id,
        value => { access = value },
        error => {
          access = false
          log(`routine access subscription failed: ${error.message}`, 'warn')
        },
      )
    : null
  try {
    if (accessSubscription) {
      access = await accessSubscription.initial
      if (!access || !await routineReady(automationId, profile.id, false)) return
    } else if (!await routineReady(automationId, profile.id, false)) return
    await withProfile(profile, { headless: routine.headless, openSession, automationId }, async session => {
      await runRoutineSession(automation, profile.id, session.page, log, shouldStop, undefined, () => access)
    })
  } catch (error) {
    if (shouldStop()) throw error
    await routineRecordSession(automationId, profile.id, false, error instanceof Error ? error.message : String(error))
  } finally {
    accessSubscription?.unsubscribe()
  }
}

export async function runAutomation(
  input: AnyRecord,
  openSession = openBrowserSession,
): Promise<void> {
  const automation = (input.automation || {}) as DbAutomationRow & AnyRecord
  const nodes = (
    Array.isArray(automation.nodes) ? automation.nodes : []
  ) as AutomationNode[]
  const edges = (
    Array.isArray(automation.edges) ? automation.edges : []
  ) as AutomationEdge[]
  const nodeStates: AnyRecord = {
    ...(automation.nodeStates || {}),
  }
  const aggregateStates = nodeStates
  const automationId = String(input.automationId || 'automation')
  const setupConfig = startConfig(nodes)
  const lists = automation.routine ? automation.listIds ?? [] : selectedLists(nodes)
  if (!lists.length)
    throw new Error(
      'Select at least one profile list before running the automation',
    )
  // Test runners inject a browser opener. Real workers use a single reactive
  // snapshot instead of repeatedly fetching the same tables over HTTP.
  const useRealtime = openSession === openBrowserSession
  const monitor = useRealtime ? new RuntimeMonitor(automationId, lists.map(String)) : null
  try {
    const runtime = monitor ? await monitor.initial : null
    if (useRealtime && !runtime) throw new Error('Automation runtime not found')
    let latestRuntime = runtime
    if (useRealtime && isTruncatedSnapshot(latestRuntime)) {
      latestRuntime = await expandedRuntimeSnapshot(automationId, lists, latestRuntime)
      if (latestRuntime && !isTruncatedSnapshot(latestRuntime)) {
        log(`runtime snapshot truncated; swept ${latestRuntime.profiles.length} profiles across windows`, 'warn')
      }
    }
    const profiles = (latestRuntime
      ? latestRuntime.profiles as DbProfileRow[]
      : await profilesList()
    ).filter((profile) =>
        profileEligible(
          profile,
          lists,
          setupConfig.profileReopenCooldownEnabled
            ? number(setupConfig.profileReopenCooldownMinutes, 30)
            : 0,
        ),
      )

    await event('session_started', { automationId: automationId })
    if (!profiles.length)
      log('No available profiles in the selected lists; waiting for profiles')

    // Free Cloak tier allows one browser at a time.
    const parallel = 1
    let previousProxy: string | undefined
    const hasWarmup = nodes.some(node => node.data?.activityId === 'browse_feed')
    const repeat = !!automation.routine || setupConfig.repeatWhileActive === true && hasWarmup
    const profileDone = (profileId: string) => {
      const run = aggregateStates.__profileRuns?.[profileId]
      return !!run?.completed && !repeat
    }
    const runProfile = async (profile: DbProfileRow) => {
      shutdownSignal.throwIfAborted()
      if (profileDone(profile.id)) return
      if (automation.routine) {
        await runRoutineProfile({
          profile, automation, routine: automation.routine,
          automationId, openSession, useRealtime,
        })
        return
      }
      if (hasWarmup && !warmupReady(await warmupGetByProfile(profile.id))) return
      await withProfile(
        profile,
        {
          headless: setupConfig.headlessMode ?? false,
          openSession,
          automationId,
        },
        async (session, controls) => {
          previousProxy = profileProxyKey(profile)
          await executeGraphProfile({
            automationId, profile, session, controls, nodes, edges,
            aggregateStates, repeat, emit: event, log,
          })
        },
      )
    }
    const runQueue = async (profiles: DbProfileRow[], snapshot: RuntimeSnapshot = null) => {
      const pending = profiles.filter(profile => !profileDone(profile.id) &&
        (!automation.routine || !snapshot || routineMayRun(snapshot, profile.id)))
      // Resting profiles must not affect proxy alternation among runnable profiles.
      const ready = hasWarmup
        ? await Promise.all(pending.map(async profile => warmupReady(await warmupGetByProfile(profile.id))))
        : pending.map(() => true)
      await runPool(orderProfileQueue(pending.filter((_, index) => ready[index]), previousProxy), parallel, runProfile)
    }
    await runQueue(profiles, latestRuntime)

    // Active automations keep watching their lists. Real workers react to
    // Convex updates; the polling branch remains only for isolated tests.
    const cooldownMinutes = setupConfig.profileReopenCooldownEnabled
      ? number(setupConfig.profileReopenCooldownMinutes, 30)
      : 0
    if (useRealtime) {
      while (monitor?.isActive()) {
        // Sweep all windows when truncated so wakeups cover rest periods in
        // later windows too; otherwise a profile outside the first prefix
        // would never shorten the sleep.
        const snapshot = await expandedRuntimeSnapshot(automationId, lists, monitor.snapshot)
        // Time-based readiness (warmup rest, cooldown, day rollover) produces
        // no table write, so wake on a timeout as well as on subscription updates.
        const sleepMs = nextWakeupDelayMs(snapshot, cooldownMinutes)
        if (!await monitor.wait(sleepMs)) break
        if (monitor.error) break
        const current = await expandedRuntimeSnapshot(automationId, lists, monitor.snapshot)
        const fresh = (current?.profiles ?? []).filter(
          (profile: any) =>
            !profileDone(String(profile.id)) &&
            profileEligible(profile as DbProfileRow, lists, cooldownMinutes),
        ) as DbProfileRow[]
        if (fresh.length) await runQueue(fresh, current)
      }
    } else {
      while (await shouldKeepWatching(automationId)) {
        await sleep(profilePollIntervalMs).catch(() => undefined)
        shutdownSignal.throwIfAborted()
        if (!(await shouldKeepWatching(automationId))) break
        try {
          const fresh = (await profilesList()).filter(
            (profile) =>
              !profileDone(profile.id) &&
              profileEligible(profile, lists, cooldownMinutes),
          )
          if (fresh.length) await runQueue(fresh)
        } catch (error) {
          log(`watch poll failed: ${error instanceof Error ? error.message : String(error)}`, 'warn')
        }
      }
    }

    if (monitor?.error) throw monitor.error

    await event('session_ended', {
      automationId: automationId,
      status: 'completed',
      nodeStates: nodeStates,
    })
  } finally {
    monitor?.stop()
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
  const input = JSON.parse(await readCommandInput()) as AnyRecord
  if (!input.automation) throw new Error('automation is required')
  try {
    await runAutomation(input)
  } finally {
    releaseStdin()
    await closeConvexRealtime()
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error)
    log(message, 'error')
    await event('session_ended', {
      status: shouldStop() ? 'cancelled' : 'failed',
      error: message,
    }).catch(() => undefined)
    process.exitCode = shouldStop() ? 0 : 1
  })
