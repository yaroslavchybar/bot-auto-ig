import path from 'path'
import fs from 'fs'
import {
  activeDisplays,
  clearAutomationProfileActive,
  markAutomationProfileActive,
  automationWorkers,
} from '../shared/store.js'
import { broadcast } from '../websocket.js'
import { automationMutex } from '../shared/mutex.js'
import { createLogStreamParser, parseLogOutput, isBenignBrowserStderr, type ParsedLog } from '../logs/parser.js'
import {
  automationsGetById,
  automationsStart,
  automationsUpdateStatus,
  type DbAutomationRow,
} from '../shared/convexClient.js'
import logger from '../shared/logger.js'
import { latestQueue } from '../shared/latest-queue.js'
import {
  spawnBun,
  killProcess,
  requestChildStop,
  guardChildStdin,
  getPid,
  waitForExit,
  type ChildProcess,
} from '../shared/ProcessService.js'
import { NotFoundError, ValidationError } from '../shared/errors.js'
import { resolveProjectRoot } from '../shared/utils.js'

const PROJECT_ROOT = resolveProjectRoot(import.meta.url)
const AUTOMATION_RUNNER = fs.existsSync(path.join(PROJECT_ROOT, 'server', 'automation', 'worker.ts'))
  ? path.join(PROJECT_ROOT, 'server', 'automation', 'worker.ts')
  : path.join(PROJECT_ROOT, 'server', 'dist', 'automation', 'worker.js')

// ---------------------------------------------------------------------------
// Utility helpers (re-exported from ProcessService)
// ---------------------------------------------------------------------------

export { getPid, waitForExit }

/** Alias for ProcessService.killProcess — used by stopAutomations. */
const stopProcess = killProcess

type TerminalStatus = 'completed' | 'failed' | 'cancelled'
type WorkerLifecycle = {
  stopRequested: boolean
  statusUpdates?: Promise<void>
  terminalStatus?: TerminalStatus
}

const workerLifecycles = new WeakMap<ChildProcess, WorkerLifecycle>()

function lifecycleFor(proc: ChildProcess): WorkerLifecycle {
  let lifecycle = workerLifecycles.get(proc)
  if (!lifecycle) {
    lifecycle = { stopRequested: false }
    workerLifecycles.set(proc, lifecycle)
  }
  return lifecycle
}

/** Wait for queued checkpoints before inspecting a worker's final state. */
export async function waitForStatusUpdates(proc: ChildProcess): Promise<void> {
  await lifecycleFor(proc).statusUpdates
}

export function isStopNoiseLog(message: string): boolean {
  const m = String(message || '')
  return (
    /Future exception was never retrieved/i.test(m) ||
    /BrokenPipeError/i.test(m) ||
    /Broken pipe/i.test(m) ||
    /Traceback \(most recent call last\)/i.test(m)
  )
}

export function displayKey(automationId: string, profileName: string): string {
  return `${automationId}:${profileName}`
}

export function clearAutomationDisplays(automationId: string): void {
  for (const [key, session] of activeDisplays.entries()) {
    if (session.automationId === automationId) {
      activeDisplays.delete(key)
    }
  }
}

export function normalizeOptionalParallelProfiles(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  // Free Cloak tier allows one browser at a time.
  return 1
}

export function normalizeAutomationTerminalStatus(
  value: unknown,
): 'completed' | 'failed' | 'cancelled' {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'failed') return 'failed'
  if (normalized === 'cancelled' || normalized === 'stopped') return 'cancelled'
  return 'completed'
}

// ---------------------------------------------------------------------------
// Automation status query
// ---------------------------------------------------------------------------

export function getAutomationStatus(automationId?: string) {
  if (automationId) {
    const worker = automationWorkers.get(automationId)
    return {
      automationId,
      status: worker?.status ?? 'idle',
      running: Boolean(worker),
      startedAt: worker?.startedAt ?? null,
    }
  }

  return {
    running: automationWorkers.size > 0,
    runningCount: automationWorkers.size,
    automations: Array.from(automationWorkers.entries()).map(([id, w]) => ({
      automationId: id,
      status: w.status,
      startedAt: w.startedAt,
    })),
  }
}

// ---------------------------------------------------------------------------
// Spawn and wire up the Bun automation subprocess
// ---------------------------------------------------------------------------

function buildPayload(automationId: string, automation: DbAutomationRow, parallelProfiles?: number) {
  return JSON.stringify({
    automationId,
    automation: {
      _id: automationId,
      routine: automation.routine,
      listIds: automation.listIds,
      name: automation.name,
      nodes: automation.nodes ?? [],
      edges: automation.edges ?? [],
      nodeStates: automation.nodeStates ?? {},
      currentNodeId: automation.currentNodeId ?? null,
    },
    parallelProfiles,
  })
}

async function handleStatusEvent(
  automationId: string,
  log: ReturnType<typeof parseLogOutput>[number],
): Promise<TerminalStatus | undefined> {
  const meta = log.metadata || {}
  const eventType = log.eventType
  const nextNodeStates = meta.nodeStates
  const nextCurrentNodeId = meta.nodeId
  const terminal = eventType === 'session_ended'
  if (terminal) clearAutomationProfileActive(automationId)
  const status = terminal ? normalizeAutomationTerminalStatus(meta.status) : 'running'
  await automationsUpdateStatus({
    automationId,
    status,
    error: terminal && typeof meta.error === 'string' ? meta.error : undefined,
    currentNodeId: nextCurrentNodeId ? String(nextCurrentNodeId) : undefined,
    nodeStates: nextNodeStates,
  })
  return terminal ? status as TerminalStatus : undefined
}

function handleDisplayEvent(automationId: string, log: ParsedLog): void {
  const meta = log.metadata || {}
  const eventType = log.eventType || ''
  const profileName = String(meta.profileName ?? '').trim()
  const key = profileName ? displayKey(automationId, profileName) : null

  if (eventType === 'display_allocated' && key) {
    const vncPort = Number(meta.vncPort)
    const displayNum = Number(meta.displayNum)
    if (!Number.isFinite(vncPort) || !Number.isFinite(displayNum)) return
    activeDisplays.set(key, {
      automationId,
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

/** Route parsed worker events to status, display, and UI state. */
function createWorkerEventRouter(automationId: string, lifecycle: WorkerLifecycle) {
  let currentProfile: string | null = null
  let lastCheckpoint: Record<string, unknown> | undefined
  const updates = latestQueue<ParsedLog>(async log => {
    try {
      const terminalStatus = await handleStatusEvent(automationId, log)
      if (terminalStatus) lifecycle.terminalStatus = terminalStatus
    } catch (error) {
      logger.error({ err: error, automationId }, 'Automation status update failed')
    }
  })
  return (log: ParsedLog): void => {
    if (lifecycle.stopRequested && isStopNoiseLog(log.message)) return
    if (log.eventType === 'profile_started' || log.eventType === 'profile_completed') {
      const name = String(log.metadata?.profileName || '')
      if (log.eventType === 'profile_started') {
        currentProfile = name
        if (name) markAutomationProfileActive(automationId, name)
      } else {
        currentProfile = null
        if (name) clearAutomationProfileActive(automationId, name)
      }
    }
    if (['checkpoint', 'session_started', 'session_ended'].includes(log.eventType || '')) {
      if (log.eventType === 'checkpoint') lastCheckpoint = log.metadata
      if (log.eventType === 'session_ended' && log.metadata?.nodeStates == null && lastCheckpoint) {
        log.metadata = { ...lastCheckpoint, ...log.metadata }
      }
      lifecycle.statusUpdates = updates.push(log)
    }
    if (log.eventType === 'checkpoint') return
    handleDisplayEvent(automationId, log)
    const { nodeStates, ...uiMetadata } = log.metadata || {}
    broadcast({
      automationId,
      type: log.eventType || 'log',
      message: log.message,
      level: log.level,
      source: 'typescript',
      profileName: currentProfile,
      ...uiMetadata,
    })
  }
}

function wireStdout(proc: ChildProcess, automationId: string): void {
  const parser = createLogStreamParser()
  const route = createWorkerEventRouter(automationId, lifecycleFor(proc))
  const consume = (parsed: ParsedLog[]) => parsed.forEach(route)
  proc.stdout?.on('data', (data: Buffer) => consume(parser.write(data)))
  proc.stdout?.on('end', () => consume(parser.end()))
}

function wireStderr(proc: ChildProcess, automationId: string): void {
  const lifecycle = lifecycleFor(proc)
  // Buffered like stdout: a banner line split across chunks would classify
  // as error in halves. Flush leftovers when the stream (or child) ends.
  const parser = createLogStreamParser()
  const consume = (logs: ParsedLog[]) => {
    for (const log of logs) {
      const stopRequested = lifecycle.stopRequested
      if (stopRequested && isStopNoiseLog(log?.message)) continue
      broadcast({
        type: 'log',
        automationId,
        message: log.message,
        level: log.explicitLevel ? log.level : (isBenignBrowserStderr(log.message) ? 'info' : 'error'),
        source: 'typescript',
      })
    }
  }
  proc.stderr?.on('data', (data: Buffer) => consume(parser.write(data)))
  proc.stderr?.on('end', () => consume(parser.end()))
  proc.on('close', () => consume(parser.end()))
}

export function wireProcessLifecycle(proc: ChildProcess, automationId: string): void {
  const lifecycle = lifecycleFor(proc)
  let spawnError: Error | undefined
  proc.on('close', async (code: number | null) => {
    await waitForStatusUpdates(proc)
    if (automationWorkers.get(automationId)?.process !== proc) return
    broadcast({
      type: 'log',
      automationId,
      message: `Automation finished with code ${code}`,
      level: code === 0 ? 'success' : 'warn',
      source: 'server',
    })

    try {
      const finalStatus = lifecycle.stopRequested ? 'cancelled'
        : lifecycle.terminalStatus === 'failed' || lifecycle.terminalStatus === 'cancelled'
          ? lifecycle.terminalStatus
          : !spawnError && code === 0 ? 'completed' : 'failed'
      if (finalStatus !== lifecycle.terminalStatus) {
        await automationsUpdateStatus({ automationId, status: finalStatus, error: spawnError?.message })
      }
    } catch { /* noop */ }
    if (automationWorkers.get(automationId)?.process !== proc) return
    automationWorkers.delete(automationId)
    clearAutomationDisplays(automationId)
    clearAutomationProfileActive(automationId)
    broadcast({ type: 'automation_status', automationId, status: 'idle' })
  })

  proc.on('error', (err: Error) => {
    spawnError = err
    broadcast({
      type: 'log',
      automationId,
      message: `Automation error: ${err.message}`,
      level: 'error',
      source: 'server',
    })
  })
}

// ---------------------------------------------------------------------------
// Public: run an automation
// ---------------------------------------------------------------------------

export interface RunAutomationInput {
  automationId: string
  parallelProfiles?: number
}

export async function runAutomation(input: RunAutomationInput, spawn = spawnBun): Promise<void> {
  const { automationId, parallelProfiles } = input

  let automation = await automationsGetById(automationId)
  if (!automation) {
    throw new NotFoundError('Automation not found')
  }
  if (automation.isActive === false) {
    throw new ValidationError('Automation is disabled')
  }

  automation = await automationsStart(automationId)
  if (!automation) throw new NotFoundError('Automation not found')

  broadcast({ type: 'automation_status', automationId, status: 'running' })
  broadcast({
    type: 'log',
    automationId,
    message: `Starting automation: ${automation.name}`,
    level: 'info',
    source: 'server',
  })

  const proc = spawn({
    args: [AUTOMATION_RUNNER],
  })
  // Injected spawn doubles in tests skip spawnBun's own guard.
  guardChildStdin(proc)
  automationWorkers.set(automationId, { process: proc, status: 'running', startedAt: Date.now() })

  wireStdout(proc, automationId)
  wireStderr(proc, automationId)
  wireProcessLifecycle(proc, automationId)

  const payload = buildPayload(automationId, automation, parallelProfiles)
  // One JSON line, stdin stays open: later `stop` lines abort the run
  // (signals don't reach detached children on Windows).
  try {
    const stdin = proc.stdin
    if (!stdin || stdin.destroyed) throw new Error('stdin unavailable')
    stdin.on('error', () => undefined)
    await new Promise<void>((resolve, reject) => {
      stdin.write(`${payload}\n`, (error?: Error | null) => error ? reject(error) : resolve())
    })
  } catch {
    await stopProcess(proc)
    throw new Error('Automation worker closed stdin before reading input')
  }
}

// ---------------------------------------------------------------------------
// Public: stop automation(s)
// ---------------------------------------------------------------------------

export async function stopAutomations(automationId?: string): Promise<string[]> {
  const idsToStop = automationId
    ? [automationId]
    : Array.from(automationWorkers.keys())

  const stopped: string[] = []

  for (const id of idsToStop) {
    const worker = automationWorkers.get(id)
    if (!worker) continue
    automationWorkers.set(id, { ...worker, status: 'stopping' })
    lifecycleFor(worker.process).stopRequested = true
    broadcast({ type: 'automation_status', automationId: id, status: 'stopping' })
    broadcast({
      type: 'log',
      automationId: id,
      message: 'Stopping automation...',
      level: 'warn',
      source: 'server',
    })
    // Cooperative stop first so open browsers close cleanly and free the
    // license seat; force-kill only if the worker stays alive.
    if (!(await requestChildStop(worker.process))) {
      await stopProcess(worker.process)
    }
    stopped.push(id)
  }

  return stopped
}

export { automationMutex, automationWorkers }
