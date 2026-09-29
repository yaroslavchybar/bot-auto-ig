import logger, { LogScope, ingestLogEntry } from '../shared/logger.js'
import fs from 'fs'
import path from 'path'
import { profileManager } from './data.js'
import {
  profilesSyncStatus,
} from '../shared/convexClient.js'
import { activeDisplays, profileProcesses } from '../shared/store.js'
import { broadcast } from '../websocket.js'
import { isBenignBrowserStderr, createLogStreamParser, type ParsedLog } from '../logs/parser.js'
import { normalizeProfileCookiesJson } from './cookies.js'
import { spawnBun, killProcess, requestChildStop, guardChildStdin } from '../shared/ProcessService.js'
import { NotFoundError, ValidationError } from '../shared/errors.js'
import { resolveProjectRoot } from '../shared/utils.js'
import { automationMutex } from '../shared/mutex.js'
import type { ChildProcess } from '../shared/ProcessService.js'

const processScopes = new WeakMap<ChildProcess, LogScope>()
const stoppedProcesses = new WeakSet<ChildProcess>()

const profileCleanup = new Map<ChildProcess, Promise<void>>()

const PROJECT_ROOT = resolveProjectRoot(import.meta.url)
const LAUNCHER_SCRIPT = fs.existsSync(path.join(PROJECT_ROOT, 'server', 'browser', 'manual.ts'))
  ? path.join(PROJECT_ROOT, 'server', 'browser', 'manual.ts')
  : path.join(PROJECT_ROOT, 'server', 'dist', 'browser', 'manual.js')

export function normalizeProfileInput(body: Record<string, unknown> = {}): any {
  const normalizedCookies = normalizeProfileCookiesJson(body.cookiesJson)
  return {
    ...body,
    cookiesJson: normalizedCookies,
  }
}

function manualDisplayKey(profileName: string): string {
  return `manual:${profileName}`
}

function setManualDisplay(
  profileName: string,
  vncPort: number,
  displayNum: number,
  automationId: string = 'manual',
) {
  activeDisplays.set(manualDisplayKey(profileName), {
    automationId,
    profileName,
    vncPort,
    displayNum,
    status: 'active',
  })
}

function clearManualDisplay(profileName: string): boolean {
  return activeDisplays.delete(manualDisplayKey(profileName))
}

function handleChildOutput(name: string, logs: ParsedLog[], scope: LogScope, stream: 'stdout' | 'stderr') {
  for (const log of logs) {
    if (log.logEntry) { ingestLogEntry(log.logEntry); continue }
    if (!log.eventType) {
      scope.note(stream === 'stderr' && !isBenignBrowserStderr(log.message) ? 'error' : log.level,
        { event: 'worker.output', message: log.message, stream })
      continue
    }
    const meta = log.metadata || {}
    if (log.eventType === 'display_allocated') {
      const vncPort = Number(meta.vncPort)
      const displayNum = Number(meta.displayNum)
      if (Number.isFinite(vncPort) && Number.isFinite(displayNum))
        setManualDisplay(name, vncPort, displayNum, String(meta.automationId ?? 'manual'))
    } else if (log.eventType === 'display_released') clearManualDisplay(name)
    broadcast({ ...meta, type: log.eventType, profileName: name })
  }
}

function handleChildExit(name: string) {
  const hadDisplay = clearManualDisplay(name)
  if (hadDisplay) {
    broadcast({
      type: 'display_released',
      automationId: 'manual',
      profile: name,
      profileName: name,
      source: 'server',
    })
  }

}

function handleChildError(name: string) {
  const hadDisplay = clearManualDisplay(name)
  if (hadDisplay) {
    broadcast({
      type: 'display_released',
      automationId: 'manual',
      profile: name,
      profileName: name,
      source: 'server',
    })
  }

}

/** Start a profile browser process and register it. */
export async function startProfileBrowser(name: string, spawn = spawnBun): Promise<void> {
  const release = await automationMutex.acquire()
  try {
    if (profileProcesses.has(name)) throw new ValidationError('Profile browser already running')
    await launchProfileBrowser(name, spawn)
  } finally {
    release()
  }
}

async function launchProfileBrowser(name: string, spawn: typeof spawnBun): Promise<void> {
  const profiles = await profileManager.getProfiles()
  const profile = profiles.find((p) => p.name === name)

  if (!profile) {
    throw new NotFoundError('Profile not found')
  }
  if (profile.status === 'deleting' || profile.renameFrom)
    throw new ValidationError('Profile maintenance is in progress')

  const args = [LAUNCHER_SCRIPT, '--name', name, '--automation-id', 'manual']

  logger.info({ event: 'profiles.service.starting_browser_for_profile', message: `Starting browser for profile: ${name}`, profileName: name })

  const scope = new LogScope('browser.process', { profileName: name, profileId: profile.id })
  const child = spawn({
    args,
    extraEnv: { LOG_SERVICE: 'manual-worker', LOG_REQUEST_ID: scope.requestId },
    // stdin stays piped: UI stop sends `stop` for a clean shutdown
    // (Windows cannot signal detached children, so this replaces SIGBREAK).
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  // Injected spawn doubles in tests skip spawnBun's own guard.
  guardChildStdin(child)

  scope.add({ pid: child.pid })
  processScopes.set(child, scope)
  for (const stream of ['stdout', 'stderr'] as const) {
    const parser = createLogStreamParser()
    const consume = (logs: ParsedLog[]) => handleChildOutput(name, logs, scope, stream)
    child[stream]?.on('data', (data: Buffer) => consume(parser.write(data)))
    child[stream]?.on('end', () => consume(parser.end()))
    child.once('close', () => consume(parser.end()))
  }
  profileProcesses.set(name, child)
  const running = profilesSyncStatus(name, 'running', true)
  let cleanup: Promise<void> | undefined
  const finish = () => (cleanup ??= (async () => {
    await running.catch(() => undefined)
    if (profileProcesses.get(name) !== child) {
      scope.add({ exitCode: child.exitCode })
      scope.finish(stoppedProcesses.has(child) ? 'cancelled' : child.exitCode === 0 ? 'success' : 'error')
      profileCleanup.delete(child)
      return
    }
    try {
      await profilesSyncStatus(name, 'idle', false)
    } catch (error) { scope.note('error', { event: 'browser.status_save', error }) }
    if (profileProcesses.get(name) === child) {
      profileProcesses.delete(name)
      handleChildExit(name)
    }
    scope.add({ exitCode: child.exitCode })
    scope.finish(stoppedProcesses.has(child) ? 'cancelled' : child.exitCode === 0 ? 'success' : 'error')
    profileCleanup.delete(child)
  })())
  const cleaned = new Promise<void>(resolve => {
    child.once('close', () => { void finish().then(resolve) })
  })
  profileCleanup.set(child, cleaned)
  child.on('error', err => { scope.add({ error: err, outcome: 'error' }); handleChildError(name) })
  try {
    await running
  } catch (error) {
    await killProcess(child)
    await cleaned
    throw error
  }
}

/** Stop a profile browser process. */
export async function stopProfileBrowser(name: string): Promise<void> {
  const release = await automationMutex.acquire()
  try {
    await stopProfileBrowserLocked(name)
  } finally {
    release()
  }
}

export async function stopProfileBrowserLocked(name: string): Promise<void> {
  const proc = profileProcesses.get(name)
  if (!proc) {
    throw new ValidationError('No browser running for this profile')
  }

  stoppedProcesses.add(proc)
  processScopes.get(proc)?.add({ outcome: 'cancelled' })

  // Cooperative stop first: the child saves cookies and closes Chromium,
  // which frees the Cloak license seat. A force-kill leaves the seat held
  // ~15 minutes. Chromium shutdown + DB save can take seconds, so allow
  // more time than the generic kill chain before escalating.
  if (await requestChildStop(proc)) {
    await profileCleanup.get(proc)
    return
  }

  await killProcess(proc)

  await profileCleanup.get(proc)
}
