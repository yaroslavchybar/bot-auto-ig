import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { FingerprintGenerator } from 'fingerprint-generator'
import { profileManager } from './data.js'
import type { Profile } from './data.js'
import {
  profilesSyncStatus,
  profilesUpdateByName,
} from '../shared/convexClient.js'
import { activeDisplays, profileProcesses } from '../shared/store.js'
import { broadcast } from '../websocket.js'
import { parseLogOutput } from '../logs/parser.js'
import { normalizeProfileCookiesJson } from './cookies.js'
import logger from '../shared/logger.js'
import { spawnBun, killProcess } from '../shared/ProcessService.js'
import { NotFoundError, ValidationError } from '../shared/errors.js'
import { resolveProjectRoot } from '../shared/utils.js'

const PROJECT_ROOT = resolveProjectRoot(import.meta.url)
const LAUNCHER_SCRIPT = fs.existsSync(path.join(PROJECT_ROOT, 'server', 'browser', 'manual.ts'))
  ? path.join(PROJECT_ROOT, 'server', 'browser', 'manual.ts')
  : path.join(PROJECT_ROOT, 'server', 'dist', 'browser', 'manual.js')

export function normalizeProfileInput(body: Record<string, unknown> = {}): any {
  const normalizedCookies = normalizeProfileCookiesJson(body.cookies_json ?? body.cookiesJson)
  return {
    ...body,
    cookies_json: normalizedCookies,
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

export async function generateFingerprint(os: string): Promise<any> {
  const targetOs = ({ mac: 'macos', macos: 'macos', linux: 'linux', windows: 'windows' } as Record<string, 'macos' | 'linux' | 'windows'>)[
    String(os || 'windows').toLowerCase()
  ] || 'windows'
  const generator = new FingerprintGenerator({
    browsers: ['firefox'],
    operatingSystems: [targetOs],
    mockWebRTC: true,
  })
  return generator.getFingerprint({
    browsers: ['firefox'],
    operatingSystems: [targetOs],
    mockWebRTC: true,
    screen: { minWidth: 1280, maxWidth: 1920, minHeight: 720, maxHeight: 1080 },
  }).fingerprint
}

/** Auto-generate fingerprint seed if missing, broadcasting result. */
async function ensureFingerprintSeed(profile: Profile): Promise<void> {
  if (profile.fingerprint_seed) return

  const newSeed = crypto.randomUUID()
  const defaultOs = profile.fingerprint_os || 'windows'
  try {
    await profilesUpdateByName(profile.name, {
      name: profile.name,
      proxy: profile.proxy,
      proxy_type: profile.proxy_type,
      fingerprint_seed: newSeed,
      fingerprint_os: defaultOs,
      test_ip: profile.test_ip,
      daily_scraping_limit: profile.daily_scraping_limit,
      assigned_accounts_limit: profile.assigned_accounts_limit,
    })
    profile.fingerprint_seed = newSeed
    profile.fingerprint_os = defaultOs
    broadcast({
      type: 'log',
      message: `Auto-generated fingerprint seed for ${profile.name}: ${newSeed.slice(0, 8)}...`,
      level: 'info',
      source: 'server',
      profileName: profile.name,
    })
  } catch (e) {
    logger.error({ err: e, profile: profile.name }, 'Failed to auto-generate fingerprint seed')
  }
}

function handleChildStdout(name: string, data: Buffer) {
  const raw = data.toString()
  const parsed = parseLogOutput(raw)
  for (const log of parsed) {
    const meta = (log.metadata as any) || {}
    const eventType = log.eventType || 'log'
    if (eventType === 'display_allocated') {
      const vncPort = Number(meta.vnc_port ?? meta.vncPort)
      const displayNum = Number(meta.display_num ?? meta.displayNum)
      const workflowId = String(meta.workflow_id ?? meta.workflowId ?? 'manual')
      if (Number.isFinite(vncPort) && Number.isFinite(displayNum)) {
        setManualDisplay(name, vncPort, displayNum, workflowId)
      }
    } else if (eventType === 'display_released') {
      clearManualDisplay(name)
    }
    broadcast({
      type: eventType,
      workflowId: String(meta.workflow_id ?? meta.workflowId ?? 'manual'),
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
      workflowId: String(meta.workflow_id ?? meta.workflowId ?? 'manual'),
      message: log.message,
      level: log.explicitLevel ? log.level : 'error',
      source: 'typescript',
      profileName: name,
      ...meta,
    })
  }
}

function handleChildExit(name: string, code: number | null) {
  profileProcesses.delete(name)
  void profilesSyncStatus(name, 'idle', false)
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
  profileProcesses.delete(name)
  void profilesSyncStatus(name, 'idle', false)
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
export async function startProfileBrowser(name: string): Promise<void> {
  const profiles = await profileManager.getProfiles()
  const profile = profiles.find((p) => p.name === name)

  if (!profile) {
    throw new NotFoundError('Profile not found')
  }

  await ensureFingerprintSeed(profile)

  const args = [LAUNCHER_SCRIPT, '--name', name, '--action', 'manual', '--workflow-id', 'manual']

  if (profile.proxy) args.push('--proxy', profile.proxy)
  if (profile.fingerprint_seed) args.push('--fingerprint-seed', profile.fingerprint_seed)
  if (profile.fingerprint_os) args.push('--fingerprint-os', profile.fingerprint_os)

  broadcast({
    type: 'log',
    message: `Starting browser for profile: ${name}`,
    level: 'info',
    source: 'server',
    profileName: name,
  })

  const child = spawnBun({
    args,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform === 'win32',
  })

  child.stdout?.on('data', (data) => handleChildStdout(name, data))
  child.stderr?.on('data', (data) => handleChildStderr(name, data))
  child.on('exit', (code) => handleChildExit(name, code))
  child.on('error', (err) => handleChildError(name, err))

  profileProcesses.set(name, child)
  await profilesSyncStatus(name, 'running', true)
}

/** Stop a profile browser process. */
export async function stopProfileBrowser(name: string): Promise<void> {
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

  profileProcesses.delete(name)
  await profilesSyncStatus(name, 'idle', false)
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
}
