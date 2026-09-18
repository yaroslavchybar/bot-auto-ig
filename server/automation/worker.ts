import type { WorkerEvent } from '../shared/contracts.js'
import {
  openBrowserSession,
  type BrowserSession,
} from '../browser/cloak.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sleep, shouldStop, shutdownSignal, requestStop, releaseStdin } from '../browser/lifecycle.js'
import {
  profilesList,
  profilesSyncStatus,
  type DbProfileRow,
  type DbAutomationRow,
} from '../shared/convexClient.js'
import { DEFAULT_SETTINGS, type InstagramSettings } from '../shared/types.js'
import { runPool } from './pool.js'
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
import {
  browseFeed,
  watchStories,
} from './actions.js'

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

function settingsFrom(input: AnyRecord): InstagramSettings {
  return { ...DEFAULT_SETTINGS, ...input } as InstagramSettings
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

async function runConfiguredAction(
  action: string,
  session: BrowserSession,
  settings: AnyRecord,
  profile: DbProfileRow,
  shouldStop: () => boolean,
): Promise<void> {
  const logAction = (message: string) => log(`${profile.name}: ${message}`)
  const page = session.page

  if (action === 'Feed Scroll' && settings.enable_feed !== false) {
    await browseFeed(
      page,
      random(
        number(settings.feed_min_time_minutes, 1),
        number(settings.feed_max_time_minutes, 3),
      ),
      settings,
      logAction,
      shouldStop,
    )
  } else if (action === 'Watch Stories' && settings.watch_stories !== false) {
    await watchStories(
      page,
      number(settings.stories_max, 3),
      logAction,
      shouldStop,
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
  const lists = selectedLists(nodes)
  if (!lists.length)
    throw new Error(
      'Select at least one profile list before running the automation',
    )
  const profiles = (await profilesList()).filter((profile) =>
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
    throw new Error('No available logged-in profile in the selected lists')

  // Free Cloak tier allows one browser at a time.
  const parallel = 1
  const runProfile = async (profile: DbProfileRow) => {
    shutdownSignal.throwIfAborted()
    if (aggregateStates.__profileRuns?.[profile.id]?.completed) return
    await withProfile(
      profile,
      {
        headless: setupConfig.headlessMode ?? false,
        openSession,
        automationId,
      },
      async (session, controls) => {
        const runs = (aggregateStates.__profileRuns ??= {})
        const run = (runs[profile.id] ??= {
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
              await browseFeed(
                session.page,
                random(
                  number(config.feed_min_time_minutes, 1),
                  number(config.feed_max_time_minutes, 3),
                ),
                config,
                log,
                shouldStop,
              )
            } else if (activity === 'watch_stories') {
              await watchStories(
                session.page,
                number(config.stories_max, 3),
                log,
                shouldStop,
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
  await runPool(profiles, parallel, (profile) => runProfile(profile))

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
      status: shouldStop() ? 'stopped' : 'failed',
      error: message,
    }).catch(() => undefined)
    process.exitCode = shouldStop() ? 0 : 1
  })
