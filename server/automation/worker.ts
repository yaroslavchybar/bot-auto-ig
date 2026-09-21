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
} from '../shared/convexRealtime.js'
import { runWarmup, warmupReady } from './warmup.js'
import { runRoutineSession } from './routine.js'
import { routineReady, routineRecordSession } from '../shared/convexClient.js'
import { runPool } from './pool.js'
import { orderProfileQueue, profileProxyKey } from './profile-queue.js'
import {
  advanceLoop,
  nextNode,
  nodeActivity,
  selectedLists,
  startConfig,
  profileEligible,
  type AutomationNode,
  type AutomationEdge,
} from './graph.js'
import { watchStories } from './actions.js'

type AnyRecord = Record<string, any>
type LogLevel = 'info' | 'warn' | 'error' | 'success'

const random = (min: number, max: number) =>
  min + Math.random() * Math.max(0, max - min)

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
  const warmups = new Map<string, { profileId: string; nextRunAt?: number }>()
  const progress = new Map<string, { profileId: string; nextRunAt?: number }>()
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
    this.pending++
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

function nodeConfig(node: AutomationNode): AnyRecord {
  return node.data?.config || {}
}

function chooseCondition(config: AnyRecord): 'true' | 'false' {
  if (config.check === 'time') {
    const hour = new Date().getHours()
    const [min, max] = String(config.value || '0-24')
      .split('-')
      .map(Number)
    return hour >= (min || 0) && hour <= (max || 24) ? 'true' : 'false'
  }
  if (config.check === 'day') {
    const days = String(config.value || '')
      .split(',')
      .map((value) => Number(value.trim()))
    return days.includes(new Date().getDay()) ? 'true' : 'false'
  }
  return Math.random() * 100 < number(config.value, 50) ? 'true' : 'false'
}

function chooseBranch(config: AnyRecord): string {
  const weights = String(config.weights || '50,50')
    .split(',')
    .map((value) => Math.max(0, Number(value) || 0))
  const pick =
    Math.random() * (weights.reduce((sum, value) => sum + value, 0) || 1)
  let cursor = 0
  for (let index = 0; index < weights.length; index++) {
    cursor += weights[index]
    if (pick <= cursor) return ['path_a', 'path_b', 'path_c'][index] || 'path_a'
  }
  return 'path_a'
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
  const updates = new UpdateSignal()
  let runtimeHealthy = true
  let runtimeError: Error | undefined
  let latestRuntime: RuntimeSnapshot | null = null
  let runtimeInitialized = false
  let profileRevision = ''
  let automationRevision = ''
  let timingRevision = ''
  let configChanged = false
  const runtimeSubscription = useRealtime
    ? watchRoutineRuntime(
        automationId,
        lists.map(String),
        snapshot => {
          const nextProfileRevision = JSON.stringify((snapshot?.profiles ?? []).map(profile => ({
            id: profile.id,
            name: profile.name,
            status: profile.status,
            using: profile.using,
            igLoggedIn: profile.igLoggedIn,
            outreachReady: profile.outreachReady,
            listIds: profile.listIds,
            lastOpenedAt: profile.lastOpenedAt,
            renameFrom: profile.renameFrom,
          })))
          const nextTimingRevision = JSON.stringify({
            warmups: snapshot?.warmups ?? [],
            progress: snapshot?.progress ?? [],
          })
          const nextAutomationRevision = `${snapshot?.automation?.status ?? ''}:${snapshot?.automation?.isActive !== false}`
          const nextConfigRevision = String(snapshot?.automation?.configRevision ?? '')
          const changed = runtimeInitialized &&
            (nextProfileRevision !== profileRevision || nextAutomationRevision !== automationRevision || nextTimingRevision !== timingRevision || nextConfigRevision !== String((latestRuntime?.automation as AnyRecord | undefined)?.configRevision ?? ''))
          if (runtimeInitialized && nextConfigRevision !== String((latestRuntime?.automation as AnyRecord | undefined)?.configRevision ?? '')) {
            configChanged = true
            runtimeHealthy = false
            runtimeError = new Error('Automation configuration changed; restarting worker')
          }
          latestRuntime = snapshot
          profileRevision = nextProfileRevision
          automationRevision = nextAutomationRevision
          timingRevision = nextTimingRevision
          if (changed || configChanged) updates.notify()
          runtimeInitialized = true
        },
        error => {
          runtimeHealthy = false
          runtimeError = error
          log(`runtime subscription failed: ${error.message}`, 'warn')
          updates.notify()
        },
      )
    : null
  const runtime = runtimeSubscription
    ? await runtimeSubscription.initial
    : null
  if (useRealtime && !runtime) throw new Error('Automation runtime not found')
  latestRuntime = runtime
  if (useRealtime && isTruncatedSnapshot(latestRuntime)) {
    try {
      const full = await loadFullRuntimeSnapshot(automationId, lists.map(String), latestRuntime)
      latestRuntime = full
      log(`runtime snapshot truncated; swept ${full.profiles.length} profiles across windows`, 'warn')
    } catch (error) {
      log(`full runtime sweep failed, using first window: ${error instanceof Error ? error.message : String(error)}`, 'warn')
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
      let access = true
      const accessSubscription = useRealtime
        ? watchRoutineAccess(
            automationId,
            profile.id,
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
        await withProfile(profile, { headless: automation.routine.headless, openSession, automationId }, async session => {
          await runRoutineSession(automation, profile.id, session.page, log, shouldStop, undefined, () => access)
        })
      } catch (error) {
        if (shouldStop()) throw error
        await routineRecordSession(automationId, profile.id, false, error instanceof Error ? error.message : String(error))
      } finally {
        accessSubscription?.unsubscribe()
      }
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
        const runs = (aggregateStates.__profileRuns ??= {})
        const date = new Date().toISOString().slice(0, 10)
        if (repeat && (runs[profile.id]?.completed || runs[profile.id]?.date !== date)) delete runs[profile.id]
        const run = (runs[profile.id] ??= {
          date,
          states: {},
          currentNodeId: null,
          completed: false,
        })
        if (run.completed) return
        const nodeStates = run.states as AnyRecord
        const report = async (type: WorkerEvent['type'], data: AnyRecord) => {
          Object.assign(aggregateStates, nodeStates)
          await event(type, {
            ...data,
            profileName: profile.name,
          })
          await event('checkpoint', {
            automationId: automationId,
            nodeId: run.currentNodeId,
            nodeStates: aggregateStates,
          })
        }
        let current =
          nodes.find((node) => node.id === run.currentNodeId) ||
          nodes.find((node) => node.type === 'start') ||
          nodes.find((node) => !edges.some((edge) => edge.target === node.id))
        if (!current) throw new Error('Automation has no start node')
        let iterations = 0

        while (current && iterations++ < 500) {
          shutdownSignal.throwIfAborted()
          const activity = nodeActivity(current)
          const config = nodeConfig(current)
          run.currentNodeId = current.id
          nodeStates[current.id] = {
            ...nodeStates[current.id],
            status: 'running',
            startedAt: Date.now(),
            completedAt: undefined,
            error: undefined,
          }
          await report('task_started', {
            automationId: automationId,
            nodeId: current.id,
            task: activity,
          })

          let handle = ['start', 'delay'].includes(activity)
            ? 'next'
            : 'success'
          try {
            if (activity === 'delay') {
              await sleep(
                random(
                  number(config.minSeconds, 1),
                  number(config.maxSeconds, 1),
                ) * 1000,
              )
            } else if (activity === 'condition') {
              handle = chooseCondition(config)
            } else if (activity === 'random_branch') {
              handle = chooseBranch(config)
            } else if (activity === 'loop') {
              handle = advanceLoop(
                nodeStates[current.id],
                number(config.iterations, 3),
              )
            } else if (activity === 'browse_feed') {
              await runWarmup(profile.id, automationId, config, session.page, log, shouldStop)
            } else if (activity === 'watch_stories') {
              await watchStories(
                session.page,
                number(config.stories_max, 3),
                log,
                shouldStop,
                {
                  minSeconds: number(config.stories_min_view_seconds, 2),
                  maxSeconds: number(config.stories_max_view_seconds, 5),
                },
              )
            } else if (activity === 'close_browser') {
              await controls.close()
            } else if (activity === 'start') {
              // The automation already owns its browser session. Start only configures it.
            } else {
              throw new Error(`Unsupported automation activity: ${activity}`)
            }
          } catch (error) {
            nodeStates[current.id] = {
              ...nodeStates[current.id],
              status: 'failed',
              error: String(error),
            }
            await report('task_progress', {
              automationId: automationId,
              nodeId: current.id,
            })
            if (
              !edges.some(
                (edge) =>
                  edge.source === current!.id &&
                  edge.sourceHandle === 'failure',
              )
            )
              throw error
            current = nextNode(nodes, edges, current, 'failure')
            run.currentNodeId = current?.id ?? null
            run.completed = !current
            await report('task_progress', {
              automationId: automationId,
              nodeId: current?.id,
            })
            continue
          }

          nodeStates[current.id] = {
            ...nodeStates[current.id],
            status: 'completed',
            completedAt: Date.now(),
          }
          if (activity === 'close_browser') {
            // Terminal: the browser session is gone, so nothing downstream can run.
            run.currentNodeId = null
            run.completed = true
            await report('task_completed', {
              automationId: automationId,
              nodeId: current.id,
              task: activity,
            })
            current = undefined
            continue
          }
          const next = nextNode(nodes, edges, current, handle)
          run.currentNodeId = next?.id ?? null
          run.completed = !next
          await report('task_completed', {
            automationId: automationId,
            nodeId: current.id,
            task: activity,
          })
          current = next
        }
        if (current)
          throw new Error('Automation exceeded the 500-node execution limit')
        run.completed = true
        run.currentNodeId = null
      },
    )
  }
  const runQueue = async (profiles: DbProfileRow[]) => {
    const pending = profiles.filter(profile => !profileDone(profile.id))
    // Resting profiles must not affect proxy alternation among runnable profiles.
    const ready = hasWarmup
      ? await Promise.all(pending.map(async profile => warmupReady(await warmupGetByProfile(profile.id))))
      : pending.map(() => true)
    await runPool(orderProfileQueue(pending.filter((_, index) => ready[index]), previousProxy), parallel, runProfile)
  }
  await runQueue(profiles)

  // Active automations keep watching their lists. Real workers react to
  // Convex updates; the polling branch remains only for isolated tests.
  const cooldownMinutes = setupConfig.profileReopenCooldownEnabled
    ? number(setupConfig.profileReopenCooldownMinutes, 30)
    : 0
  if (useRealtime) {
    while (runtimeHealthy && latestRuntime?.automation &&
      (latestRuntime.automation.status === 'running' || latestRuntime.automation.status === 'pending') &&
      latestRuntime.automation.isActive !== false) {
      // Sweep all windows when truncated so wakeups cover rest periods in
      // later windows too; otherwise a profile outside the first prefix
      // would never shorten the sleep.
      let snapshot = latestRuntime
      if (isTruncatedSnapshot(snapshot)) {
        try {
          snapshot = await loadFullRuntimeSnapshot(automationId, lists.map(String), snapshot)
        } catch (error) {
          log(`full runtime sweep failed: ${error instanceof Error ? error.message : String(error)}`, 'warn')
          snapshot = latestRuntime
        }
      }
      // Time-based readiness (warmup rest, cooldown, day rollover) produces
      // no table write, so wake on a timeout as well as on subscription updates.
      const sleepMs = nextWakeupDelayMs(snapshot, cooldownMinutes)
      if (!await updates.wait(shutdownSignal, sleepMs)) break
      if (!runtimeHealthy) break
      let current = latestRuntime
      if (isTruncatedSnapshot(current)) {
        try {
          current = await loadFullRuntimeSnapshot(automationId, lists.map(String), current)
        } catch (error) {
          log(`full runtime sweep failed: ${error instanceof Error ? error.message : String(error)}`, 'warn')
          current = latestRuntime
        }
      }
      const fresh = (current?.profiles ?? []).filter(
        (profile: any) =>
          !profileDone(String(profile.id)) &&
          profileEligible(profile as DbProfileRow, lists, cooldownMinutes),
      ) as DbProfileRow[]
      if (fresh.length) await runQueue(fresh)
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

  runtimeSubscription?.unsubscribe()
  if (configChanged) throw runtimeError
  if (runtimeError) throw runtimeError

  await event('session_ended', {
    automationId: automationId,
    status: 'completed',
    nodeStates: nodeStates,
  })
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
