/**
 * ProcessService — Centralized Bun child-process spawning, killing,
 * and PID tracking for the server.
 *
 * All runner-process spawning MUST go through this module.
 * No other module should directly import `spawn` from `child_process`
 * for runner processes.
 */
import { spawn as nodeSpawn, execFile, ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import logger from './logger.js'
import { browserBudgetEndpoint } from '../browser/budget.js'
import { resolveProjectRoot } from './utils.js'

export type { ChildProcess }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ROOT = resolveProjectRoot(import.meta.url)

/** Persistent registry of spawned PIDs so a restart can find orphans. */
const DATA_DIR = path.join(PROJECT_ROOT, 'data')
const PID_REGISTRY_FILE = path.join(DATA_DIR, 'process-registry.json')

const DEFAULT_SIGTERM_WAIT_MS = 2000
const EXTENDED_SIGTERM_WAIT_MS = 5000

// ---------------------------------------------------------------------------
// Spawn options
// ---------------------------------------------------------------------------

export interface SpawnBunOptions {
  /** Arguments for the Bun script (script path + flags). */
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
// not stored in workflowWorkers / profileProcesses.
// ---------------------------------------------------------------------------

const processRegistry = new Set<ChildProcess>()

/** Spawn metadata needed to verify a stored PID still names our child. */
type RegistryMeta = {
  script: string
  detached: boolean
  spawnedAt: number
}

const processMeta = new Map<ChildProcess, RegistryMeta>()

/** Return a snapshot of all currently tracked child processes. */
export function getTrackedProcesses(): ReadonlySet<ChildProcess> {
  return processRegistry
}

/** Register a child process for lifecycle tracking. */
function trackProcess(proc: ChildProcess, meta: RegistryMeta): void {
  processRegistry.add(proc)
  processMeta.set(proc, meta)
  persistRegistry()
  const cleanup = () => {
    processRegistry.delete(proc)
    processMeta.delete(proc)
    persistRegistry()
  }
  proc.once('exit', cleanup)
  proc.once('error', cleanup)
}

// ---------------------------------------------------------------------------
// PID persistence — detached children survive a server crash, so their
// identities are written to disk on every spawn/exit and reconciled at
// startup. Bare PIDs are never trusted: the OS can recycle them, so each
// entry carries the expected command and spawn time, verified before any
// signal is sent.
// ---------------------------------------------------------------------------

/** Persistent registry entry. `script` is an absolute path; `detached`
 * decides group kill vs PID kill. */
export type RegistryEntry = {
  pid: number
  script: string
  detached: boolean
  spawnedAt: number
}

/** Max clock skew accepted between a stored spawn time and the live process. */
export const ORPHAN_IDENTITY_TOLERANCE_MS = 120_000

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function registryEntryFor(pid: number, meta: RegistryMeta): RegistryEntry {
  return { pid, script: meta.script, detached: meta.detached, spawnedAt: meta.spawnedAt }
}

/** Write entries to disk. Deletes the file when empty so a late exit event
 * after clearRegistry() cannot resurrect dead PIDs. Best-effort, never throws. */
function writeRegistry(entries: RegistryEntry[]): void {
  try {
    ensureDataDir()
    if (entries.length === 0) {
      if (fs.existsSync(PID_REGISTRY_FILE)) fs.unlinkSync(PID_REGISTRY_FILE)
      return
    }
    fs.writeFileSync(PID_REGISTRY_FILE, JSON.stringify(entries), 'utf-8')
  } catch (err) {
    logger.error({ err }, 'Failed to persist process registry')
  }
}

/** Write all currently tracked children to disk. */
function persistRegistry(): void {
  writeRegistry(
    [...processRegistry]
      .map((proc) => {
        const pid = getPid(proc)
        const meta = processMeta.get(proc)
        return pid === null || !meta ? null : registryEntryFor(pid, meta)
      })
      .filter((entry): entry is RegistryEntry => entry !== null),
  )
}

/** Parse registry content. Legacy bare-PID files predate identity checks
 * and are unverifiable, so they are dropped (fail closed). Relative script
 * paths from older files resolve against the project root (the default
 * spawn cwd); current writers always store absolute paths. */
export function parseRegistryEntries(parsed: unknown): RegistryEntry[] {
  if (!Array.isArray(parsed)) return []
  const entries: RegistryEntry[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const { pid, script, detached, spawnedAt } = item as Record<string, unknown>
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) continue
    if (typeof script !== 'string' || !script.trim()) continue
    if (typeof detached !== 'boolean') continue
    if (typeof spawnedAt !== 'number' || !Number.isFinite(spawnedAt) || spawnedAt <= 0) continue
    const abs = path.isAbsolute(script) ? script : path.resolve(PROJECT_ROOT, script)
    entries.push({ pid, script: abs, detached, spawnedAt })
  }
  return entries
}

/** Read stored entries from a previous server run. Returns [] when absent/invalid. */
function readRegistry(): RegistryEntry[] {
  try {
    if (!fs.existsSync(PID_REGISTRY_FILE)) return []
    return parseRegistryEntries(JSON.parse(fs.readFileSync(PID_REGISTRY_FILE, 'utf-8')))
  } catch {
    return []
  }
}

/** Clear the persistent PID registry. */
export function clearRegistry(): void {
  try {
    if (fs.existsSync(PID_REGISTRY_FILE)) {
      fs.unlinkSync(PID_REGISTRY_FILE)
    }
  } catch (err) {
    logger.error({ err }, 'Failed to clear process registry')
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Clean up orphaned automation processes from previous server runs.
 * Every stored PID is identity-checked (exact script arg + start time)
 * before any signal is sent, so a recycled PID can never kill a stranger's
 * process. An entry leaves the registry only when its process is dead,
 * proven foreign, or successfully terminated — unverifiable identities and
 * failed kills stay on disk for the next startup to retry.
 */
export async function cleanupOrphanedProcesses(): Promise<void> {
  const entries = readRegistry().filter((entry) => entry.pid !== process.pid)

  if (entries.length === 0) {
    logger.info('No orphaned processes to clean up')
    return
  }

  const unresolved: RegistryEntry[] = []
  for (const entry of entries) {
    if (!isProcessRunning(entry.pid)) continue
    const live = await getLiveProcIdentity(entry.pid)
    if (!live) {
      logger.warn({ pid: entry.pid }, 'Skipping orphan cleanup: identity unavailable, will retry on next startup')
      unresolved.push(entry)
      continue
    }
    if (!registryEntryMatches(entry, live)) {
      logger.warn({ pid: entry.pid }, 'Skipping orphan cleanup: process identity does not match registry')
      continue
    }
    logger.info({ pid: entry.pid, script: entry.script }, 'Found orphaned process from previous run')
    await killOrphanTree(entry)
    if (isProcessRunning(entry.pid)) {
      logger.warn({ pid: entry.pid }, 'Orphan cleanup did not terminate the process, will retry on next startup')
      unresolved.push(entry)
    }
  }

  writeRegistry(unresolved)
}

/** Live process identity used to confirm a stored PID still names our child. */
export type LiveProcIdentity = {
  argv: string[]
  startMs: number
}

/** Fold platform path differences so one spelling matches (win32 only). */
export function normalizeScriptPath(p: string): string {
  const clean = String(p || '').trim()
  if (!clean) return ''
  return process.platform === 'win32' ? clean.replace(/\//g, '\\').toLowerCase() : clean
}

/** Split a command-line string into argv, honoring single/double quotes. */
export function splitCommandLine(cmdline: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cmdline)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '')
  }
  return out.filter((s) => s.length > 0)
}

/** True when one exact command argument equals the stored absolute script
 * path and the start time matches. Substring/basename matches are rejected:
 * a recycled PID running a same-named script elsewhere must never match. */
export function registryEntryMatches(entry: RegistryEntry, live: LiveProcIdentity): boolean {
  const expected = normalizeScriptPath(entry.script)
  if (!expected) return false
  const hit = live.argv.some((arg) => normalizeScriptPath(arg) === expected)
  if (!hit) return false
  return Math.abs(live.startMs - entry.spawnedAt) <= ORPHAN_IDENTITY_TOLERANCE_MS
}

/**
 * Read a process command line + start time. Returns null when unavailable —
 * callers must treat that as "do not kill" (fail closed).
 */
export function getLiveProcIdentity(pid: number): Promise<LiveProcIdentity | null> {
  if (process.platform === 'win32') return getWindowsProcIdentity(pid)
  return getUnixProcIdentity(pid)
}

function execFileAsync(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 10_000 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(String(stdout || ''))
    })
  })
}

/** Exact argv from /proc (Linux). Null when unavailable. */
function readProcArgv(pid: number): string[] | null {
  if (process.platform === 'win32') return null
  try {
    const parts = fs.readFileSync(`/proc/${pid}/cmdline`).toString('utf8').split('\0').filter(Boolean)
    return parts.length > 0 ? parts : null
  } catch {
    return null
  }
}

/** Unix identity via ps start time plus exact argv (/proc, else tokenized ps). */
async function getUnixProcIdentity(pid: number): Promise<LiveProcIdentity | null> {
  try {
    const out = await execFileAsync('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'args='])
    const line = out.trimEnd()
    if (line.length <= 24) return null
    const startMs = Date.parse(line.slice(0, 24).trim())
    const argsStr = line.slice(24).trim()
    if (!Number.isFinite(startMs) || !argsStr) return null
    return { argv: readProcArgv(pid) ?? splitCommandLine(argsStr), startMs }
  } catch {
    return null
  }
}

/** Windows identity via a single CIM query. CreationDate is converted to the
 * DMTF format parseWindowsCreationDate accepts — PowerShell 5.1 JSON would
 * otherwise serialize the .NET DateTime as /Date(...)/ and verification
 * would always fail. */
async function getWindowsProcIdentity(pid: number): Promise<LiveProcIdentity | null> {
  try {
    const out = await execFileAsync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | ForEach-Object { [pscustomobject]@{ CommandLine = $_.CommandLine; CreationDate = [System.Management.ManagementDateTimeConverter]::ToDmtfDateTime($_.CreationDate) } } | ConvertTo-Json -Compress`,
    ])
    const parsed = JSON.parse(out.trim()) as { CommandLine?: unknown; CreationDate?: unknown }
    const cmdline = typeof parsed?.CommandLine === 'string' ? parsed.CommandLine : ''
    const startMs = parseWindowsCreationDate(parsed?.CreationDate)
    if (!cmdline || startMs === null) return null
    return { argv: splitCommandLine(cmdline), startMs }
  } catch {
    return null
  }
}

/** Parse WMI datetime "yyyyMMddHHmmss.ffffff±ooo" into epoch millis. */
export function parseWindowsCreationDate(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.\d+)?([+-]\d{3})?$/.exec(value.trim())
  if (!match) return null
  const [, y, mo, d, h, mi, s, tz] = match as RegExpMatchArray & string[]
  const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  if (!Number.isFinite(utcMs)) return null
  // WMI offset is in minutes behind/ahead of UTC already applied in reverse:
  // value is local wall time, so subtract the offset to get UTC.
  const offsetMin = tz ? Number(tz) : 0
  if (!Number.isFinite(offsetMin)) return null
  return utcMs - offsetMin * 60_000
}

/**
 * Kill a verified orphan. Group kill only when the child was spawned
 * detached (its own group leader, pgid === pid) — a non-detached child
 * shares our group, so -pid would signal the server itself.
 */
async function killOrphanTree(entry: RegistryEntry): Promise<void> {
  const { pid, detached } = entry
  if (process.platform === 'win32') {
    await taskkillTree(pid)
    return
  }

  if (!detached) {
    await killOrphanPid(pid)
    return
  }

  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    await killOrphanPid(pid)
    return
  }

  await sleep(DEFAULT_SIGTERM_WAIT_MS)
  if (!isProcessRunning(pid)) return

  try {
    process.kill(-pid, 'SIGKILL')
  } catch { /* already dead */ }

  await sleep(500)
  if (isProcessRunning(pid)) {
    await killOrphanPid(pid)
  }
}

// ---------------------------------------------------------------------------
// Spawn helper
// ---------------------------------------------------------------------------

/**
 * Spawn a Bun child process with standard stdio and lifecycle tracking.
 *
 * Every spawned child is registered in the global process registry so
 * that shutdown can terminate all children, not just known categories.
 */
export function spawnBun(options: SpawnBunOptions): ChildProcess {
  const bun = process.env.BUN || 'bun'
  const cwd = options.cwd ?? PROJECT_ROOT
  const stdio = (options.stdio ?? ['pipe', 'pipe', 'pipe']) as any
  const shell = options.shell ?? false
  const detached =
    options.detached !== undefined
      ? options.detached
      : process.platform !== 'win32'

  const env: Record<string, string | undefined> = {
    ...process.env,
    ...options.extraEnv,
    BROWSER_BUDGET_ENDPOINT: browserBudgetEndpoint(),
  }

  const child = nodeSpawn(bun, options.args, {
    cwd,
    detached,
    stdio,
    shell,
    env,
  })

  const scriptArg = options.args[0] || ''
  trackProcess(child, {
    script: path.isAbsolute(scriptArg) ? scriptArg : path.resolve(cwd, scriptArg),
    detached,
    spawnedAt: Date.now(),
  })

  if (child.pid) {
    logger.info(
      { pid: child.pid, script: options.args[0] },
      'Spawned Bun process',
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

