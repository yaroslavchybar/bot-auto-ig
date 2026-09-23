import type { WorkerEvent } from '../shared/contracts.js'
import type { BrowserSession } from '../browser/cloak.js'
import { sleep, shouldStop, shutdownSignal } from '../browser/lifecycle.js'
import type { DbProfileRow } from '../shared/convexClient.js'
import { runWarmup } from './warmup.js'
import { watchStories } from './actions.js'
import { advanceLoop, nextNode, nodeActivity, type AutomationNode, type AutomationEdge } from './graph.js'

type AnyRecord = Record<string, any>

type GraphProfileContext = {
  automationId: string
  profile: DbProfileRow
  session: BrowserSession
  controls: { close: () => Promise<void> }
  nodes: AutomationNode[]
  edges: AutomationEdge[]
  aggregateStates: AnyRecord
  repeat: boolean
  emit: (type: WorkerEvent['type'], data: AnyRecord) => Promise<void>
  log: (message: string, level?: 'info' | 'warn' | 'error' | 'success') => void
}

const random = (min: number, max: number) =>
  min + Math.random() * Math.max(0, max - min)

function number(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
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

/** Execute one profile's saved graph and report each checkpoint. */
export async function executeGraphProfile(context: GraphProfileContext): Promise<void> {
  const { automationId, profile, session, controls, nodes, edges, aggregateStates, repeat, emit, log } = context
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
    await emit(type, {
      ...data,
      profileName: profile.name,
    })
    await emit('checkpoint', {
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
}
