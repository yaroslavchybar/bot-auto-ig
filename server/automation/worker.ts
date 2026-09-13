import {
  openCamoufoxSession,
  type CamoufoxSession,
} from '../browser/camoufox.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sleep, shouldStop, shutdownSignal } from '../browser/lifecycle.js'
import {
  profilesList,
  profilesSyncStatus,
  type DbProfileRow,
  type DbWorkflowRow,
} from '../shared/convexClient.js'
import { DEFAULT_SETTINGS, type InstagramSettings } from '../shared/types.js'
import { scrapeRelationships } from './scrape.js'
import {
  advanceLoop,
  nextNode,
  nodeActivity,
  selectedLists,
  profileEligible,
  type WorkflowNode,
  type WorkflowEdge,
} from './graph.js'
import {
  approveRequests,
  browseFeed,
  browseReels,
  followUsers,
  sendMessages,
  unfollowUsers,
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

function event(type: string, data: AnyRecord = {}): void {
  process.stdout.write(
    `__EVENT__${JSON.stringify({ type, ts: new Date().toISOString(), ...data })}__EVENT__\n`,
  )
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
    workflowId?: string
    openSession?: typeof openCamoufoxSession
  } = {},
  run: (session: CamoufoxSession, controls: {
    close: () => Promise<void>
    reopen: (headless?: boolean) => Promise<CamoufoxSession>
  }) => Promise<void>,
): Promise<void> {
  const workflowId = options.workflowId || 'automation'
  let session: CamoufoxSession | undefined
  let closed = false
  let markedRunning = false
  const close = async () => {
    if (!session || closed) return
    await session.close()
    closed = true
    if (session.display) event('display_released', { workflow_id: workflowId, profile: profile.name })
  }
  const reopen = async (headless = options.headless ?? true) => {
    if (closed) {
      session = await (options.openSession ?? openCamoufoxSession)(profile.name, { headless })
      closed = false
      if (session.display) event('display_allocated', {
        workflow_id: workflowId, profile: profile.name,
        display_num: session.display.displayNum, vnc_port: session.display.vncPort,
      })
    }
    return session!
  }
  try {
    session = await (options.openSession ?? openCamoufoxSession)(profile.name, {
      headless: options.headless ?? true,
    })
    await profilesSyncStatus(profile.name, 'running', true)
    markedRunning = true
    event('profile_started', {
      profile: profile.name,
      profile_id: profile.profile_id,
      workflow_id: workflowId,
    })
    if (session.display)
      event('display_allocated', {
        workflow_id: workflowId,
        profile: profile.name,
        display_num: session.display.displayNum,
        vnc_port: session.display.vncPort,
      })
    await run(session, { close, reopen })
    event('profile_completed', {
      profile: profile.name,
      profile_id: profile.profile_id,
      workflow_id: workflowId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log(`${profile.name}: ${message}`, 'error')
    event('error', {
      profile: profile.name,
      profile_id: profile.profile_id,
      workflow_id: workflowId,
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
  session: CamoufoxSession,
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
  } else if (action === 'Reels Scroll' && settings.enable_reels) {
    await browseReels(
      page,
      random(
        number(settings.reels_min_time_minutes, 1),
        number(settings.reels_max_time_minutes, 3),
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
  } else if (action === 'Follow' && settings.enable_follow) {
    await followUsers(page, profile.profile_id, logAction, shouldStop, settings)
  } else if (action === 'Unfollow' && settings.do_unfollow) {
    await unfollowUsers(
      page,
      profile.profile_id,
      logAction,
      shouldStop,
      settings,
    )
  } else if (action === 'Approve Requests' && settings.do_approve) {
    await approveRequests(page, logAction, shouldStop)
  } else if (action === 'Send Messages' && settings.do_message) {
    await sendMessages(
      page,
      profile.profile_id,
      logAction,
      shouldStop,
      settings,
    )
  }
}

async function runAutomation(input: AnyRecord): Promise<void> {
  const settings = settingsFrom(input.settings || {})
  const profiles = (await profilesList())
    .filter((profile) =>
      profileEligible(
        profile,
        settings.source_list_ids,
        settings.profile_reopen_cooldown_enabled
          ? settings.profile_reopen_cooldown_minutes
          : 0,
      ),
    )
    .slice(0, Math.max(1, number(settings.max_sessions, 5)))
  const stop = shouldStop

  event('session_started', {
    workflow_id: 'automation',
    total_profiles: profiles.length,
  })
  log(`Starting TypeScript automation for ${profiles.length} profile(s)`)

  const actions = Array.isArray(settings.action_order)
    ? settings.action_order
    : []
  const parallel = Math.max(
    1,
    Math.min(10, Math.floor(number(settings.parallel_profiles, 1))),
  )
  for (let offset = 0; offset < profiles.length; offset += parallel) {
    shutdownSignal.throwIfAborted()
    const batch = profiles.slice(offset, offset + parallel)
    const results = await Promise.allSettled(
      batch.map((profile) =>
        withProfile(
          profile,
          { headless: settings.headless },
          async (session) => {
            for (const action of actions) {
              if (stop()) break
              event('task_started', {
                workflow_id: 'automation',
                profile: profile.name,
                task: action,
              })
              await runConfiguredAction(
                String(action),
                session,
                settings,
                profile,
                stop,
              )
              event('task_completed', {
                workflow_id: 'automation',
                profile: profile.name,
                task: action,
              })
            }
          },
        ),
      ),
    )
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  }

  event('session_ended', { workflow_id: 'automation', status: 'completed' })
  log('TypeScript automation finished', 'success')
}

function nodeConfig(node: WorkflowNode): AnyRecord {
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

export async function runWorkflow(
  input: AnyRecord,
  openSession = openCamoufoxSession,
): Promise<void> {
  const workflow = (input.workflow || {}) as DbWorkflowRow & AnyRecord
  const nodes = (
    Array.isArray(workflow.nodes) ? workflow.nodes : []
  ) as WorkflowNode[]
  const edges = (
    Array.isArray(workflow.edges) ? workflow.edges : []
  ) as WorkflowEdge[]
  const nodeStates: AnyRecord = {
    ...(workflow.nodeStates || input.options?.node_states || {}),
  }
  const aggregateStates = nodeStates
  const workflowId = String(input.workflowId || 'workflow')
  const startConfig = nodeConfig(
    nodes.find((node) => nodeActivity(node) === 'start_browser') || { id: '' },
  )
  const lists = selectedLists(nodes)
  if (!lists.length)
    throw new Error(
      'Select at least one profile list before running the workflow',
    )
  const profiles = (await profilesList()).filter((profile) =>
    profileEligible(
      profile,
      lists,
      startConfig.profileReopenCooldownEnabled
        ? number(startConfig.profileReopenCooldownMinutes, 30)
        : 0,
    ),
  )

  event('session_started', { workflow_id: workflowId })
  if (!profiles.length)
    throw new Error('No available logged-in profile in the selected lists')

  const hasScrape = nodes.some(
    (node) => nodeActivity(node) === 'scrape_relationships',
  )
  const parallel = hasScrape
    ? 1
    : Math.max(
        1,
        Math.min(
          10,
          Math.floor(
            number(
              input.options?.parallel_profiles ?? startConfig.parallelProfiles,
              1,
            ),
          ),
        ),
      )
  const runProfile = async (profile: DbProfileRow) => {
    shutdownSignal.throwIfAborted()
    await withProfile(
      profile,
      {
        headless: input.options?.headless ?? startConfig.headlessMode ?? false,
        openSession,
        workflowId,
      },
      async (session, controls) => {
        const runs = (aggregateStates.__profileRuns ??= {})
        const run = (runs[profile.profile_id] ??= {
          states: {},
          currentNodeId: null,
          completed: false,
        })
        if (run.completed) return
        const nodeStates = run.states as AnyRecord
        const report = (type: string, data: AnyRecord) => {
          Object.assign(aggregateStates, nodeStates)
          event(type, {
            ...data,
            profile: profile.name,
            node_states: aggregateStates,
          })
        }
        let current =
          nodes.find((node) => node.id === run.currentNodeId) ||
          nodes.find((node) => node.type === 'start') ||
          nodes.find((node) => !edges.some((edge) => edge.target === node.id))
        if (!current) throw new Error('Workflow has no start node')
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
          report('task_started', {
            workflow_id: workflowId,
            node_id: current.id,
            task: activity,
          })

          let handle = [
            'start',
            'start_browser',
            'select_list',
            'close_browser',
            'delay',
          ].includes(activity)
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
            } else if (activity === 'browse_reels') {
              await browseReels(
                session.page,
                random(
                  number(config.reels_min_time_minutes, 1),
                  number(config.reels_max_time_minutes, 3),
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
            } else if (activity === 'follow_user') {
              await followUsers(
                session.page,
                profile.profile_id,
                log,
                shouldStop,
                config,
              )
            } else if (activity === 'unfollow_user') {
              await unfollowUsers(
                session.page,
                profile.profile_id,
                log,
                shouldStop,
                config,
              )
            } else if (activity === 'approve_requests') {
              await approveRequests(session.page, log, shouldStop)
            } else if (activity === 'send_dm') {
              await sendMessages(
                session.page,
                profile.profile_id,
                log,
                shouldStop,
                {
                  ...config,
                  messaging_cooldown_enabled:
                    startConfig.messagingCooldownEnabled,
                  messaging_cooldown_hours: startConfig.messagingCooldownHours,
                },
              )
            } else if (activity === 'scrape_relationships') {
              await scrapeRelationships({
                page: session.page,
                profile: session.profile,
                workflowId,
                workflowName: String(workflow.name || workflowId),
                nodeId: current.id,
                config,
                state: (aggregateStates[`scrape:${current.id}`] ??= {}),
                onProgress: () =>
                  report('task_progress', {
                    workflow_id: workflowId,
                    node_id: current!.id,
                  }),
              })
            } else if (activity === 'close_browser') {
              await controls.close()
            } else if (activity === 'start_browser') {
              session = await controls.reopen(config.headlessMode)
            } else if (
              activity === 'select_list' ||
              activity === 'start'
            ) {
              // The workflow already owns its browser session. These nodes only configure/control it.
            } else {
              throw new Error(`Unsupported workflow activity: ${activity}`)
            }
          } catch (error) {
            nodeStates[current.id] = {
              ...nodeStates[current.id],
              status: 'failed',
              error: String(error),
            }
            report('task_progress', {
              workflow_id: workflowId,
              node_id: current.id,
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
            report('task_progress', {
              workflow_id: workflowId,
              node_id: current?.id,
            })
            continue
          }

          nodeStates[current.id] = {
            ...nodeStates[current.id],
            status: 'completed',
            completedAt: Date.now(),
          }
          const next = nextNode(nodes, edges, current, handle)
          run.currentNodeId = next?.id ?? null
          run.completed = !next
          report('task_completed', {
            workflow_id: workflowId,
            node_id: current.id,
            task: activity,
          })
          current = next
        }
        if (current)
          throw new Error('Workflow exceeded the 500-node execution limit')
        run.completed = true
        run.currentNodeId = null
      },
    )
  }
  for (let offset = 0; offset < profiles.length; offset += parallel) {
    const results = await Promise.allSettled(
      profiles.slice(offset, offset + parallel).map(runProfile),
    )
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') {
      if (
        hasScrape &&
        /daily scraping limit reached/.test(String(failure.reason)) &&
        offset + parallel < profiles.length
      )
        continue
      throw failure.reason
    }
  }

  event('session_ended', {
    workflow_id: workflowId,
    status: 'completed',
    node_states: nodeStates,
  })
}

async function main(): Promise<void> {
  const input = JSON.parse(
    await new Promise<string>((resolve, reject) => {
      let value = ''
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', (chunk) => {
        value += chunk
      })
      process.stdin.on('end', () => resolve(value))
      process.stdin.on('error', reject)
    }),
  ) as AnyRecord
  if (input.workflow) await runWorkflow(input)
  else await runAutomation(input)
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    log(message, 'error')
    event('session_ended', {
      status: shouldStop() ? 'stopped' : 'failed',
      error: message,
    })
    process.exitCode = shouldStop() ? 0 : 1
  })
