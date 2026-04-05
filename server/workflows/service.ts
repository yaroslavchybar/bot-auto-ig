import path from 'path'
import { activeDisplays, workflowWorkers } from '../shared/store.js'
import { broadcast } from '../websocket.js'
import { automationMutex } from '../shared/mutex.js'
import { parseLogOutput } from '../logs/parser.js'
import {
  workflowsGetById,
  workflowsStart,
  workflowsUpdateStatus,
} from '../shared/convexClient.js'
import logger from '../shared/logger.js'
import {
  spawnPython,
  killProcess,
  getPid,
  waitForExit,
} from '../shared/ProcessService.js'
import { NotFoundError } from '../shared/errors.js'
import { resolveProjectRoot } from '../shared/utils.js'

const PROJECT_ROOT = resolveProjectRoot(import.meta.url)
const PYTHON_RUNNER = path.join(PROJECT_ROOT, 'python', 'runners', 'run_workflow.py')

// ---------------------------------------------------------------------------
// Utility helpers (re-exported from ProcessService)
// ---------------------------------------------------------------------------

export { getPid, waitForExit }

/** Alias for ProcessService.killProcess — used by stopWorkflows. */
const stopProcess = killProcess

export function isStopNoiseLog(message: string): boolean {
  const m = String(message || '')
  return (
    /Future exception was never retrieved/i.test(m) ||
    /BrokenPipeError/i.test(m) ||
    /Broken pipe/i.test(m) ||
    /Traceback \(most recent call last\)/i.test(m) ||
    /asyncio\/unix_events\.py/i.test(m)
  )
}

export function displayKey(workflowId: string, profileName: string): string {
  return `${workflowId}:${profileName}`
}

export function clearWorkflowDisplays(workflowId: string): void {
  for (const [key, session] of activeDisplays.entries()) {
    if (session.workflowId === workflowId) {
      activeDisplays.delete(key)
    }
  }
}

export function normalizeOptionalParallelProfiles(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(1, Math.min(10, Math.floor(parsed)))
}

export function normalizeWorkflowTerminalStatus(
  value: unknown,
): 'completed' | 'failed' | 'cancelled' {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'failed') return 'failed'
  if (normalized === 'cancelled') return 'cancelled'
  return 'completed'
}

// ---------------------------------------------------------------------------
// Workflow status query
// ---------------------------------------------------------------------------

export function getWorkflowStatus(workflowId?: string) {
  if (workflowId) {
    const worker = workflowWorkers.get(workflowId)
    return {
      workflowId,
      status: worker?.status ?? 'idle',
      running: Boolean(worker),
      startedAt: worker?.startedAt ?? null,
    }
  }

  return {
    running: workflowWorkers.size > 0,
    runningCount: workflowWorkers.size,
    workflows: Array.from(workflowWorkers.entries()).map(([id, w]) => ({
      workflowId: id,
      status: w.status,
      startedAt: w.startedAt,
    })),
  }
}

// ---------------------------------------------------------------------------
// Spawn and wire up the Python workflow subprocess
// ---------------------------------------------------------------------------

function buildPayload(workflowId: string, workflow: any, parallelProfiles?: number) {
  return JSON.stringify({
    workflowId,
    workflow: {
      name: workflow.name,
      nodes: workflow.nodes ?? [],
      edges: workflow.edges ?? [],
      nodeStates: workflow.nodeStates ?? {},
      currentNodeId: workflow.currentNodeId ?? null,
    },
    options: {
      ...(parallelProfiles === undefined ? {} : { parallel_profiles: parallelProfiles }),
      node_states: workflow.nodeStates ?? {},
      current_node_id: workflow.currentNodeId ?? null,
      workflow_name: workflow.name,
    },
  })
}

async function handleStatusEvent(
  workflowId: string,
  log: any,
  currentProfile: { value: string | null },
): Promise<void> {
  const meta = (log?.metadata as any) || {}
  const eventType = log?.eventType
  const nextNodeStates = meta.node_states ?? meta.nodeStates
  const nextCurrentNodeId = meta.node_id ?? meta.nodeId

  if (eventType === 'session_started') {
    try { await workflowsUpdateStatus({ workflowId, status: 'running' }) } catch { /* noop */ }
    return
  }

  if (eventType === 'profile_started') {
    currentProfile.value = meta.profile || null
  } else if (eventType === 'profile_completed') {
    currentProfile.value = null
  }

  if (
    (eventType === 'task_started' ||
      eventType === 'task_completed' ||
      eventType === 'task_progress') &&
    nextCurrentNodeId
  ) {
    try {
      await workflowsUpdateStatus({
        workflowId,
        status: 'running',
        currentNodeId: String(nextCurrentNodeId),
        nodeStates: nextNodeStates,
      })
    } catch { /* noop */ }
    return
  }

  if (eventType === 'session_ended') {
    const status = normalizeWorkflowTerminalStatus(meta?.status)
    try {
      await workflowsUpdateStatus({
        workflowId,
        status,
        currentNodeId: nextCurrentNodeId ? String(nextCurrentNodeId) : undefined,
        nodeStates: nextNodeStates,
      })
    } catch { /* noop */ }
    return
  }

  if (nextNodeStates !== undefined) {
    try {
      await workflowsUpdateStatus({
        workflowId,
        status: 'running',
        currentNodeId: nextCurrentNodeId ? String(nextCurrentNodeId) : undefined,
        nodeStates: nextNodeStates,
      })
    } catch { /* noop */ }
  }
}

function handleDisplayEvent(workflowId: string, log: any): void {
  const meta = (log?.metadata as any) || {}
  const eventType = String(log?.eventType || '')
  const profileName = String(meta.profile ?? meta.profileName ?? '').trim()
  const key = profileName ? displayKey(workflowId, profileName) : null

  if (eventType === 'display_allocated' && key) {
    const vncPort = Number(meta.vnc_port ?? meta.vncPort)
    const displayNum = Number(meta.display_num ?? meta.displayNum)
    if (!Number.isFinite(vncPort) || !Number.isFinite(displayNum)) return
    activeDisplays.set(key, {
      workflowId,
      profileName,
      vncPort,
      displayNum,
      status: 'active',
    })
    return
  }

  if ((eventType === 'display_released' || eventType === 'profile_completed') && key) {
    activeDisplays.delete(key)
  }
}

function wireStdout(
  proc: any,
  workflowId: string,
  currentProfile: { value: string | null },
): void {
  proc.stdout?.on('data', (data: Buffer) => {
    const raw = data.toString()
    const parsed = parseLogOutput(raw)

    for (const log of parsed) {
      const stopRequested = Boolean((proc as any).__stopRequested)
      if (stopRequested && isStopNoiseLog(log?.message)) continue
      void handleStatusEvent(workflowId, log, currentProfile)
      handleDisplayEvent(workflowId, log)
      broadcast({
        workflowId,
        type: log.eventType ? log.eventType : 'log',
        message: log.message,
        level: log.level,
        source: 'python',
        profileName: currentProfile.value,
        ...log.metadata,
      })
    }
  })
}

function wireStderr(proc: any, workflowId: string): void {
  proc.stderr?.on('data', (data: Buffer) => {
    const raw = data.toString()
    const parsed = parseLogOutput(raw)
    for (const log of parsed) {
      const stopRequested = Boolean((proc as any).__stopRequested)
      if (stopRequested && isStopNoiseLog(log?.message)) continue
      broadcast({
        type: 'log',
        workflowId,
        message: log.message,
        level: log.explicitLevel ? log.level : 'error',
        source: 'python',
      })
    }
  })
}

function wireProcessLifecycle(proc: any, workflowId: string): void {
  proc.on('close', async (code: number | null) => {
    workflowWorkers.delete(workflowId)
    clearWorkflowDisplays(workflowId)
    broadcast({ type: 'workflow_status', workflowId, status: 'idle' })
    broadcast({
      type: 'log',
      workflowId,
      message: `Workflow finished with code ${code}`,
      level: code === 0 ? 'success' : 'warn',
      source: 'server',
    })

    try {
      const stopRequested = Boolean((proc as any).__stopRequested)
      const finalStatus = stopRequested ? 'cancelled' : code === 0 ? 'completed' : 'failed'
      await workflowsUpdateStatus({ workflowId, status: finalStatus })
    } catch { /* noop */ }
  })

  proc.on('error', async (err: Error) => {
    workflowWorkers.delete(workflowId)
    clearWorkflowDisplays(workflowId)
    broadcast({ type: 'workflow_status', workflowId, status: 'idle' })
    broadcast({
      type: 'log',
      workflowId,
      message: `Workflow error: ${err.message}`,
      level: 'error',
      source: 'server',
    })
    try {
      await workflowsUpdateStatus({
        workflowId,
        status: 'failed',
        error: String(err?.message || err),
      })
    } catch { /* noop */ }
  })
}

// ---------------------------------------------------------------------------
// Public: run a workflow
// ---------------------------------------------------------------------------

export interface RunWorkflowInput {
  workflowId: string
  parallelProfiles?: number
}

export async function runWorkflow(input: RunWorkflowInput): Promise<void> {
  const { workflowId, parallelProfiles } = input

  const workflow = await workflowsGetById(workflowId)
  if (!workflow) {
    throw new NotFoundError('Workflow not found')
  }

  await workflowsStart(workflowId)

  broadcast({ type: 'workflow_status', workflowId, status: 'running' })
  broadcast({
    type: 'log',
    workflowId,
    message: `Starting workflow: ${workflow.name}`,
    level: 'info',
    source: 'server',
  })

  const proc = spawnPython({
    args: ['-u', PYTHON_RUNNER],
  })
  workflowWorkers.set(workflowId, { process: proc, status: 'running', startedAt: Date.now() })

  const payload = buildPayload(workflowId, workflow, parallelProfiles)
  proc.stdin?.write(payload)
  proc.stdin?.end()

  const currentProfile = { value: null as string | null }
  wireStdout(proc, workflowId, currentProfile)
  wireStderr(proc, workflowId)
  wireProcessLifecycle(proc, workflowId)
}

// ---------------------------------------------------------------------------
// Public: stop workflow(s)
// ---------------------------------------------------------------------------

export async function stopWorkflows(workflowId?: string): Promise<string[]> {
  const idsToStop = workflowId
    ? [workflowId]
    : Array.from(workflowWorkers.keys())

  const stopped: string[] = []

  for (const id of idsToStop) {
    const worker = workflowWorkers.get(id)
    if (!worker) continue
    workflowWorkers.set(id, { ...worker, status: 'stopping' })
    ;(worker.process as any).__stopRequested = true
    broadcast({ type: 'workflow_status', workflowId: id, status: 'stopping' })
    broadcast({
      type: 'log',
      workflowId: id,
      message: 'Stopping workflow...',
      level: 'warn',
      source: 'server',
    })
    await stopProcess(worker.process)
    stopped.push(id)
  }

  return stopped
}

export { automationMutex, workflowWorkers }
