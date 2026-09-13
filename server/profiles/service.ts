import fs from 'fs'
import path from 'path'
import { profileManager } from './data.js'
import {
  profilesSyncStatus,
} from '../shared/convexClient.js'
import { activeDisplays, profileProcesses } from '../shared/store.js'
import { broadcast } from '../websocket.js'
import { parseLogOutput } from '../logs/parser.js'
import { normalizeProfileCookiesJson } from './cookies.js'
import { spawnBun, killProcess } from '../shared/ProcessService.js'
import { NotFoundError, ValidationError } from '../shared/errors.js'
import { resolveProjectRoot } from '../shared/utils.js'
import { automationMutex } from '../shared/mutex.js'
import type { ChildProcess } from '../shared/ProcessService.js'

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
  workflowId: string = 'manual',
) {
  activeDisplays.set(manualDisplayKey(profileName), {
    workflowId,
    profileName,
    vncPort,
    displayNum,
    status: 'active',
  })
}

function clearManualDisplay(profileName: string): boolean {
  return activeDisplays.delete(manualDisplayKey(profileName))
}

function handleChildStdout(name: string, data: Buffer) {
  const raw = data.toString()
  const parsed = parseLogOutput(raw)
  for (const log of parsed) {
    const meta = (log.metadata as any) || {}
    const eventType = log.eventType || 'log'
    if (eventType === 'display_allocated') {
      const vncPort = Number(meta.vncPort)
      const displayNum = Number(meta.displayNum)
      const workflowId = String(meta.workflowId ?? 'manual')
      if (Number.isFinite(vncPort) && Number.isFinite(displayNum)) {
        setManualDisplay(name, vncPort, displayNum, workflowId)
      }
    } else if (eventType === 'display_released') {
      clearManualDisplay(name)
    }
    broadcast({
      type: eventType,
      workflowId: String(meta.workflowId ?? 'manual'),
      message: log.message,
      level: log.level,
      source: 'typescript',
      profileName: name,
      ...meta,
    })
  }
}

function handleChildStderr(name: string, data: Buffer) {
  const raw = data.toString()
  const parsed = parseLogOutput(raw)
  for (const log of parsed) {
    const meta = (log.metadata as any) || {}
    broadcast({
      type: log.eventType ? log.eventType : 'log',
      workflowId: String(meta.workflowId ?? 'manual'),
      message: log.message,
      level: log.explicitLevel ? log.level : 'error',
      source: 'typescript',
      profileName: name,
      ...meta,
    })
  }
}

function handleChildExit(name: string, code: number | null) {
  const hadDisplay = clearManualDisplay(name)
  if (hadDisplay) {
    broadcast({
      type: 'display_released',
      workflowId: 'manual',
      profile: name,
      profileName: name,
      source: 'server',
    })
  }
  broadcast({
    type: 'log',
    message: `Browser closed for profile: ${name} (code: ${code})`,
    level: 'info',
    source: 'server',
    profileName: name,
  })
}

function handleChildError(name: string, err: Error) {
  const hadDisplay = clearManualDisplay(name)
  if (hadDisplay) {
    broadcast({
      type: 'display_released',
      workflowId: 'manual',
      profile: name,
      profileName: name,
      source: 'server',
    })
  }
  broadcast({
    type: 'log',
    message: `Browser error for profile ${name}: ${err.message}`,
    level: 'error',
    source: 'server',
    profileName: name,
  })
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

  const args = [LAUNCHER_SCRIPT, '--name', name, '--workflow-id', 'manual']

  broadcast({
    type: 'log',
    message: `Starting browser for profile: ${name}`,
    level: 'info',
    source: 'server',
    profileName: name,
  })

  const child = spawn({
    args,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform === 'win32',
  })

  child.stdout?.on('data', (data) => handleChildStdout(name, data))
  child.stderr?.on('data', (data) => handleChildStderr(name, data))
  profileProcesses.set(name, child)
  const running = profilesSyncStatus(name, 'running', true)
  let cleanup: Promise<void> | undefined
  const finish = () => (cleanup ??= (async () => {
    await running.catch(() => undefined)
    if (profileProcesses.get(name) !== child) return
    try {
      await profilesSyncStatus(name, 'idle', false)
    } catch { /* Keep cleanup working when the database is unavailable. */ }
    if (profileProcesses.get(name) === child) {
      profileProcesses.delete(name)
      handleChildExit(name, child.exitCode)
    }
    profileCleanup.delete(child)
  })())
  const cleaned = new Promise<void>(resolve => {
    child.once('close', () => { void finish().then(resolve) })
  })
  profileCleanup.set(child, cleaned)
  child.on('error', (err) => handleChildError(name, err))
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

async function stopProfileBrowserLocked(name: string): Promise<void> {
  const proc = profileProcesses.get(name)
  if (!proc) {
    throw new ValidationError('No browser running for this profile')
  }

  broadcast({
    type: 'log',
    message: `Stopping browser for profile: ${name}`,
    level: 'warn',
    source: 'server',
    profileName: name,
  })

  await killProcess(proc)

  await profileCleanup.get(proc)
}
