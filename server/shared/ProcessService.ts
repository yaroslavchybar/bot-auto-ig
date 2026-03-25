/**
 * ProcessService — Centralized Python child-process spawning, killing,
 * and PID tracking for the server.
 *
 * All runner-process spawning MUST go through this module.
 * No other module should directly import `spawn` from `child_process`
 * for runner processes.
 */
import { spawn as nodeSpawn, execFile, ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import logger from './logger.js'

export type { ChildProcess }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** Resolve from dist/shared/ → project root. */
const PROJECT_ROOT = path.resolve(__dirname, '../../..')

/** Directory for PID file persistence. */
const DATA_DIR = path.resolve(__dirname, '../data')
const PID_FILE = path.join(DATA_DIR, 'automation.pid')

const DEFAULT_SIGTERM_WAIT_MS = 2000
const EXTENDED_SIGTERM_WAIT_MS = 5000

// ---------------------------------------------------------------------------
// Spawn options
// ---------------------------------------------------------------------------

export interface SpawnPythonOptions {
  /** Arguments for the Python interpreter (script path + flags). */
  args: string[]
  /** Override working directory (defaults to PROJECT_ROOT). */
  cwd?: string
  /** Override stdio config (defaults to ['pipe','pipe','pipe']). */
  stdio?: Array<'pipe' | 'ignore' | 'inherit'>
  /** Merge additional env vars into process.env. */
  extraEnv?: Record<string, string>
  /** Use `shell: true` when spawning. Default false. */
  shell?: boolean
  /**
   * Whether to detach on Unix so we can kill the whole process group.
   * Default: true on non-Windows, false on Windows.
   */
  detached?: boolean
}

// ---------------------------------------------------------------------------
// PID persistence (automation PID file)
// ---------------------------------------------------------------------------

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

/** Save a PID to the automation PID file. */
export function savePid(pid: number): void {
  ensureDataDir()
  fs.writeFileSync(PID_FILE, String(pid), 'utf-8')
  logger.info({ pid }, 'Saved automation PID')
}

/** Clear the automation PID file. */
export function clearPid(): void {
  try {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE)
      logger.info('Cleared PID file')
    }
  } catch (err) {
    logger.error({ err }, 'Failed to clear PID file')
  }
}

/** Read the stored automation PID (or null). */
export function getSavedPid(): number | null {
  try {
    if (!fs.existsSync(PID_FILE)) return null
    const content = fs.readFileSync(PID_FILE, 'utf-8').trim()
    const pid = parseInt(content, 10)
    return Number.isFinite(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Process-alive check
// ---------------------------------------------------------------------------

/** Check if a process with the given PID is still alive. */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Global process registry — tracks ALL spawned children so shutdown can
// kill every one, including login & fingerprint subprocesses that are
// not stored in automationState / workflowWorkers / profileProcesses.
// ---------------------------------------------------------------------------

const processRegistry = new Set<ChildProcess>()

/** Return a snapshot of all currently tracked child processes. */
export function getTrackedProcesses(): ReadonlySet<ChildProcess> {
  return processRegistry
}

/** Register a child process for lifecycle tracking. */
function trackProcess(proc: ChildProcess): void {
  processRegistry.add(proc)
  const cleanup = () => { processRegistry.delete(proc) }
  proc.once('exit', cleanup)
  proc.once('error', cleanup)
}

// ---------------------------------------------------------------------------
// Spawn helper
// ---------------------------------------------------------------------------

/**
 * Spawn a Python child process with standard env vars & stdio config.
 *
 * Uses `PYTHONUNBUFFERED=1` and `PYTHONPATH=PROJECT_ROOT` by default.
 * Every spawned child is registered in the global process registry so
 * that shutdown can terminate all children, not just known categories.
 */
export function spawnPython(options: SpawnPythonOptions): ChildProcess {
  const python = process.env.PYTHON || 'python'
  const cwd = options.cwd ?? PROJECT_ROOT
  const stdio = (options.stdio ?? ['pipe', 'pipe', 'pipe']) as any
  const shell = options.shell ?? false
  const detached =
    options.detached !== undefined
      ? options.detached
      : process.platform !== 'win32'

  const env: Record<string, string | undefined> = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PYTHONPATH: PROJECT_ROOT,
    ...options.extraEnv,
  }

  const child = nodeSpawn(python, options.args, {
    cwd,
    detached,
    stdio,
    shell,
    env,
  })

  trackProcess(child)

  if (child.pid) {
    logger.info(
      { pid: child.pid, script: options.args[0] },
      'Spawned Python process',
    )
  }

  return child
}

// ---------------------------------------------------------------------------
// Kill helpers
// ---------------------------------------------------------------------------

/** Extract a safe numeric PID from a ChildProcess (or null). */
export function getPid(proc: ChildProcess): number | null {
  const pid = proc?.pid
  return typeof pid === 'number' && Number.isFinite(pid) ? pid : null
}

/**
 * Wait for a ChildProcess to exit within `ms` milliseconds.
 * Resolves `true` if the process exited, `false` on timeout.
 */
export function waitForExit(
  proc: ChildProcess,
  ms: number,
): Promise<boolean> {
  if (proc.exitCode !== null && proc.exitCode !== undefined) {
    return Promise.resolve(true)
  }
  return new Promise<boolean>((resolve) => {
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      proc.off('exit', onExit)
      resolve(proc.exitCode !== null && proc.exitCode !== undefined)
    }, ms)
    const onExit = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(true)
    }
    proc.once('exit', onExit)
  })
}

/**
 * Platform-aware kill of a single ChildProcess.
 *
 * Windows: SIGBREAK → wait → kill() → wait → taskkill /T /F.
 * Unix:    SIGTERM on process group → wait → SIGKILL on process group.
 */
export async function killProcess(proc: ChildProcess): Promise<void> {
  const pid = getPid(proc)
  if (!pid) return

  if (process.platform === 'win32') {
    try { proc.kill('SIGBREAK') } catch { /* noop */ }
    if (await waitForExit(proc, DEFAULT_SIGTERM_WAIT_MS)) return

    try { proc.kill() } catch { /* noop */ }
    if (await waitForExit(proc, DEFAULT_SIGTERM_WAIT_MS)) return

    await taskkillTree(pid)
    return
  }

  // Unix: kill process group first, fall back to direct kill
  let usedGroupKill = false
  try {
    process.kill(-pid, 'SIGTERM')
    usedGroupKill = true
  } catch {
    try { proc.kill('SIGTERM') } catch { return }
  }

  if (await waitForExit(proc, EXTENDED_SIGTERM_WAIT_MS)) return

  // SIGKILL fallback: try process group first, then direct child kill
  if (usedGroupKill) {
    try { process.kill(-pid, 'SIGKILL') } catch { /* noop */ }
  } else {
    try { proc.kill('SIGKILL') } catch { /* noop */ }
  }
}

/**
 * Platform-aware kill using taskkill on Windows or SIGTERM→SIGKILL on Unix.
 * Intended for the simpler "stop and forget" cases (automation/profiles).
 */
export async function killByPid(
  pid: number,
  proc?: ChildProcess | null,
): Promise<void> {
  if (process.platform === 'win32') {
    await taskkillTree(pid)
    return
  }

  // Unix: try process group, fall back to direct proc.kill
  let usedGroupKill = false
  try {
    process.kill(-pid, 'SIGTERM')
    usedGroupKill = true
  } catch {
    if (proc) {
      try { proc.kill('SIGTERM') } catch { /* noop */ }
    }
  }

  await new Promise((r) => setTimeout(r, DEFAULT_SIGTERM_WAIT_MS))

  // SIGKILL fallback: try process group first, then direct child kill
  if (usedGroupKill) {
    try { process.kill(-pid, 'SIGKILL') } catch { /* noop */ }
  } else if (proc) {
    try { proc.kill('SIGKILL') } catch { /* noop */ }
  }
}

/**
 * Kill a process by PID only (no ChildProcess reference).
 * Used for orphan cleanup.
 */
export async function killOrphanPid(pid: number): Promise<boolean> {
  try {
    logger.info({ pid }, 'Attempting to kill orphaned process')
    process.kill(pid, 'SIGTERM')

    await new Promise((r) => setTimeout(r, DEFAULT_SIGTERM_WAIT_MS))

    if (isProcessRunning(pid)) {
      process.kill(pid, 'SIGKILL')
      logger.info({ pid }, 'Force killed orphaned process')
    } else {
      logger.info({ pid }, 'Process terminated gracefully')
    }
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
      logger.info({ pid }, 'Process already dead')
      return true
    }
    logger.error({ err, pid }, 'Failed to kill process')
    return false
  }
}

/** Windows-only tree kill via taskkill. */
export function taskkillTree(pid: number): Promise<void> {
  return new Promise<void>((resolve) => {
    execFile(
      'taskkill',
      ['/PID', String(pid), '/T', '/F'],
      { windowsHide: true },
      () => resolve(),
    )
  })
}

// ---------------------------------------------------------------------------
// Orphan cleanup (runs on server startup)
// ---------------------------------------------------------------------------

/**
 * Clean up orphaned automation processes from previous server runs.
 * Reads stored PID, checks if alive, kills if necessary, clears PID file.
 */
export async function cleanupOrphanedProcesses(): Promise<void> {
  const pid = getSavedPid()

  if (!pid) {
    logger.info('No orphaned processes to clean up')
    return
  }

  logger.info({ pid }, 'Found orphaned PID, checking if running')

  if (isProcessRunning(pid)) {
    await killOrphanPid(pid)
  } else {
    logger.info({ pid }, 'Orphaned process is not running')
  }

  clearPid()
}
