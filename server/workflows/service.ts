import path from 'path'
import fs from 'fs'
import {
  activeDisplays,
  clearWorkflowProfileActive,
  markWorkflowProfileActive,
  workflowWorkers,
} from '../shared/store.js'
import { broadcast } from '../websocket.js'
import { automationMutex } from '../shared/mutex.js'
import { createLogStreamParser, parseLogOutput } from '../logs/parser.js'
import {
  workflowsGetById,
  workflowsStart,
  workflowsUpdateStatus,
} from '../shared/convexClient.js'
import logger from '../shared/logger.js'
import { latestQueue } from '../shared/latest-queue.js'
import {
  spawnBun,
  killProcess,
  getPid,
  waitForExit,
} from '../shared/ProcessService.js'
import { NotFoundError } from '../shared/errors.js'
import { resolveProjectRoot } from '../shared/utils.js'

const PROJECT_ROOT = resolveProjectRoot(import.meta.url)
const WORKFLOW_RUNNER = fs.existsSync(path.join(PROJECT_ROOT, 'server', 'automation', 'worker.ts'))
  ? path.join(PROJECT_ROOT, 'server', 'automation', 'worker.ts')
  : path.join(PROJECT_ROOT, 'server', 'dist', 'automation', 'worker.js')

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
    /Traceback \(most recent call last\)/i.test(m)
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
// Spawn and wire up the Bun workflow subprocess
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
    parallelProfiles,
  })
}

async function handleStatusEvent(
  workflowId: string,
  log: ReturnType<typeof parseLogOutput>[number],
): Promise<void> {
  const meta = log.metadata || {}
  const eventType = log.eventType
  const nextNodeStates = meta.nodeStates
  const nextCurrentNodeId = meta.nodeId
  const terminal = eventType === 'session_ended'
  if (terminal) clearWorkflowProfileActive(workflowId)
  await workflowsUpdateStatus({
    workflowId,
    status: terminal ? normalizeWorkflowTerminalStatus(meta.status) : 'running',
    error: terminal && typeof meta.error === 'string' ? meta.error : undefined,
    currentNodeId: nextCurrentNodeId ? String(nextCurrentNodeId) : undefined,
    nodeStates: nextNodeStates,
  })
}

function handleDisplayEvent(workflowId: string, log: any): void {
  const meta = (log?.metadata as any) || {}
  const eventType = String(log?.eventType || '')
  const profileName = String(meta.profileName ?? '').trim()
  const key = profileName ? displayKey(workflowId, profileName) : null

  if (eventType === 'display_allocated' && key) {
    const vncPort = Number(meta.vncPort)
    const displayNum = Number(meta.displayNum)
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
  const parser = createLogStreamParser()
  let lastCheckpoint: Record<string, unknown> | undefined
  const updates = latestQueue<ReturnType<typeof parseLogOutput>[number]>(async log => {
    try { await handleStatusEvent(workflowId, log) }
    catch (error) { logger.error({ err: error, workflowId }, 'Workflow status update failed') }
  })
  const consume = (parsed: ReturnType<typeof parseLogOutput>) => {
    for (const log of parsed) {
      const stopRequested = Boolean((proc as any).__stopRequested)
      if (stopRequested && isStopNoiseLog(log?.message)) continue
      if (log.eventType === 'profile_started' || log.eventType === 'profile_completed') {
        const name = String(log.metadata?.profileName || '')
        if (log.eventType === 'profile_started') {
          currentProfile.value = name
          if (name) markWorkflowProfileActive(workflowId, name)
        } else {
          currentProfile.value = null
          if (name) clearWorkflowProfileActive(workflowId, name)
        }
      }
      if (['checkpoint', 'session_started', 'session_ended'].includes(log.eventType || '')) {
        if (log.eventType === 'checkpoint') lastCheckpoint = log.metadata
        if (
          log.eventType === 'session_ended' &&
          log.metadata?.nodeStates == null &&
          lastCheckpoint
        ) {
          log.metadata = { ...lastCheckpoint, ...log.metadata }
        }
        proc.__statusUpdates = updates.push(log)
      }
      if (log.eventType === 'checkpoint') continue
      handleDisplayEvent(workflowId, log)
      const { nodeStates, ...uiMetadata } = log.metadata || {}
      broadcast({
        workflowId,
        type: log.eventType ? log.eventType : 'log',
        message: log.message,
        level: log.level,
        source: 'typescript',
        profileName: currentProfile.value,
        ...uiMetadata,
      })
    }
  }
  proc.stdout?.on('data', (data: Buffer) => consume(parser.write(data)))
  proc.stdout?.on('end', () => consume(parser.end()))
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
        source: 'typescript',
      })
    }
  })
}

export function wireProcessLifecycle(proc: any, workflowId: string): void {
  let spawnError: Error | undefined
  proc.on('close', async (code: number | null) => {
    await proc.__statusUpdates
    if (workflowWorkers.get(workflowId)?.process !== proc) return
    broadcast({
      type: 'log',
      workflowId,
      message: `Workflow finished with code ${code}`,
      level: code === 0 ? 'success' : 'warn',
      source: 'server',
    })

    try {
      const stopRequested = Boolean((proc as any).__stopRequested)
      const finalStatus = stopRequested ? 'cancelled' : !spawnError && code === 0 ? 'completed' : 'failed'
      await workflowsUpdateStatus({ workflowId, status: finalStatus, error: spawnError?.message })
    } catch { /* noop */ }
    if (workflowWorkers.get(workflowId)?.process !== proc) return
    workflowWorkers.delete(workflowId)
    clearWorkflowDisplays(workflowId)
    clearWorkflowProfileActive(workflowId)
    broadcast({ type: 'workflow_status', workflowId, status: 'idle' })
  })

  proc.on('error', (err: Error) => {
    spawnError = err
    broadcast({
      type: 'log',
      workflowId,
      message: `Workflow error: ${err.message}`,
      level: 'error',
      source: 'server',
    })
  })
}

// ---------------------------------------------------------------------------
// Public: run a workflow
// ---------------------------------------------------------------------------

export interface RunWorkflowInput {
  workflowId: string
  parallelProfiles?: number
}

export async function runWorkflow(input: RunWorkflowInput, spawn = spawnBun): Promise<void> {
  const { workflowId, parallelProfiles } = input

  let workflow = await workflowsGetById(workflowId)
  if (!workflow) {
    throw new NotFoundError('Workflow not found')
  }

  workflow = await workflowsStart(workflowId)
  if (!workflow) throw new NotFoundError('Workflow not found')

  broadcast({ type: 'workflow_status', workflowId, status: 'running' })
  broadcast({
    type: 'log',
    workflowId,
    message: `Starting workflow: ${workflow.name}`,
    level: 'info',
    source: 'server',
  })

  const proc = spawn({
    args: [WORKFLOW_RUNNER],
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
