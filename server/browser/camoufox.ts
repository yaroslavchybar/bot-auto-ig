import fs from 'node:fs'
import path from 'node:path'
import { Camoufox } from 'camoufox-js'
import { FingerprintGenerator, type Fingerprint } from 'fingerprint-generator'
import { parseProxy, BROWSER_WINDOW_WIDTH, BROWSER_WINDOW_HEIGHT, normalizeFingerprintScreen } from './config.js'
import { shutdownSignal } from './lifecycle.js'
import { acquireBrowserSlot } from './budget.js'
import { prepareBrowserProxy } from './proxy.js'
import { allocateDisplay, type Display } from './display.js'
import type { BrowserContext, Page, Cookie } from 'playwright-core'
import {
  profilesGetByName,
  profilesUpdateByName,
  type DbProfileRow,
} from '../shared/convexClient.js'
import { resolveProjectRoot } from '../shared/utils.js'

const PROJECT_ROOT = resolveProjectRoot(import.meta.url)
const PROFILE_ROOT = path.join(PROJECT_ROOT, 'data', 'profiles')

export type CamoufoxSession = {
  context: BrowserContext
  page: Page
  profile: DbProfileRow
  display?: Display
  close: () => Promise<void>
}

function profilePath(name: string): string {
  const clean = String(name || '').trim()
  if (!clean || clean === '.' || clean === '..' || /[\\/]/.test(clean)) {
    throw new Error('Invalid profile name')
  }
  const root = path.resolve(PROFILE_ROOT)
  const result = path.resolve(root, clean)
  if (!result.startsWith(`${root}${path.sep}`))
    throw new Error('Invalid profile name')
  fs.mkdirSync(result, { recursive: true })
  return result
}

function storedCookies(profile: DbProfileRow): Cookie[] {
  if (!profile.cookies_json) return []
  try {
    const value = JSON.parse(profile.cookies_json)
    const cookies = Array.isArray(value) ? value : value?.cookies
    return Array.isArray(cookies) ? cookies : []
  } catch {
    return []
  }
}

function sessionId(cookies: Cookie[]): string {
  return cookies.find((cookie) => cookie.name === 'sessionid')?.value || ''
}

async function saveSession(
  profile: DbProfileRow,
  context: BrowserContext,
): Promise<void> {
  try {
    const cookies = await context.cookies()
    const id = sessionId(cookies)
    if (!id && !profile.session_id && cookies.length === 0) return
    await profilesUpdateByName(profile.name, {
      name: profile.name,
      cookies_json: JSON.stringify(cookies),
      session_id: id,
    })
  } catch {
    // Browser shutdown must not hide the original action error.
    process.stderr.write('Could not save browser session cookies\n')
  }
}

async function launchSession(
  profileName: string,
  options: { headless?: boolean; display?: string; userAgent?: string } = {},
): Promise<CamoufoxSession> {
  shutdownSignal.throwIfAborted()
  const profile = await profilesGetByName(profileName)
  if (!profile) throw new Error(`Profile not found: ${profileName}`)

  const profileDir = profilePath(profileName)
  const targetOs =
    profile.fingerprint_os === 'mac' || profile.fingerprint_os === 'macos'
      ? 'macos'
      : profile.fingerprint_os === 'linux'
        ? 'linux'
        : 'windows'
  const fingerprintPath = path.join(profileDir, 'fingerprint.json')
  let fingerprint: Fingerprint | undefined
  try {
    const cached = JSON.parse(fs.readFileSync(fingerprintPath, 'utf8'))
    if (cached.os === targetOs && cached.fingerprint)
      fingerprint = cached.fingerprint
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (!fingerprint) {
    fingerprint = normalizeFingerprintScreen(
      new FingerprintGenerator({
        browsers: ['firefox'],
        operatingSystems: [targetOs],
      }).getFingerprint().fingerprint,
    )
    fs.writeFileSync(
      fingerprintPath,
      JSON.stringify({
        os: targetOs,
        fingerprint,
      }),
    )
  } else {
    // Old caches hold random screens (e.g. 3840x1080). Patch and persist.
    const before = JSON.stringify(fingerprint.screen)
    normalizeFingerprintScreen(fingerprint)
    if (JSON.stringify(fingerprint.screen) !== before) {
      fs.writeFileSync(
        fingerprintPath,
        JSON.stringify({
          os: targetOs,
          fingerprint,
        }),
      )
    }
  }
  const proxy = parseProxy(profile.proxy, profile.proxy_type)
  const launchOptions: Record<string, unknown> = {
    headless: options.headless ?? false,
    user_data_dir: profileDir,
    os: targetOs,
    fingerprint,
    i_know_what_im_doing: true,
    proxy,
    geoip: Boolean(proxy),
    humanize: true,
    locale: 'en-US',
    // NOTE: window alone does nothing when an explicit fingerprint is passed
    // (camoufox-js only uses it for internal generation). The spoofed
    // outer/inner dims are set by normalizeFingerprintScreen above to match.
    window: [BROWSER_WINDOW_WIDTH, BROWSER_WINDOW_HEIGHT],
    ...(options.display
      ? { env: { ...process.env, DISPLAY: options.display } }
      : {}),
    ...(options.userAgent
      ? {
          config: { 'navigator.userAgent': options.userAgent },
          i_know_what_im_doing: true,
        }
      : {}),
  }

  const preparedProxy = await prepareBrowserProxy(proxy)
  let context: BrowserContext
  try {
    shutdownSignal.throwIfAborted()
    context = (await Camoufox({ ...launchOptions, proxy: preparedProxy.proxy })) as BrowserContext
  } catch (error) {
    await preparedProxy.close()
    throw error
  }
  context.once('close', () => { void preparedProxy.close().catch(() => undefined) })
  let closing: Promise<void> | undefined
  const close = () =>
    (closing ??= (async () => {
      shutdownSignal.removeEventListener('abort', onAbort)
      try {
        await saveSession(profile, context)
      } finally {
        try {
          await context.close()
        } finally {
          await preparedProxy.close()
        }
      }
    })())
  const onAbort = () => {
    void close().catch(() => undefined)
  }
  shutdownSignal.addEventListener('abort', onAbort, { once: true })
  let page: Page
  try {
    shutdownSignal.throwIfAborted()
    const cookies = storedCookies(profile)
    if (cookies.length) await context.addCookies(cookies)
    else if (profile.session_id)
      await context.addCookies([
        {
          name: 'sessionid',
          value: profile.session_id,
          domain: '.instagram.com',
          path: '/',
          secure: true,
          httpOnly: true,
          sameSite: 'None',
        },
      ])
    page = context.pages()[0] || (await context.newPage())
    if (page.url() === 'about:blank') {
      await page.goto('https://www.instagram.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      })
    }
  } catch (error) {
    shutdownSignal.removeEventListener('abort', onAbort)
    await context.close().catch(() => undefined)
    await preparedProxy.close()
    throw error
  }

  return {
    context,
    page,
    profile,
    close,
  }
}

/** A profile directory can belong to only one worker, including during browser startup. */
export async function openCamoufoxSession(
  profileName: string,
  options: { headless?: boolean; display?: string; userAgent?: string } = {},
): Promise<CamoufoxSession> {
  const lockPath = path.join(profilePath(profileName), 'worker.lock')
  if (fs.existsSync(lockPath)) {
    const pid = Number(fs.readFileSync(lockPath, 'utf8'))
    if (!Number.isSafeInteger(pid) || pid <= 0)
      throw new Error('Invalid profile lock')
    try {
      process.kill(pid, 0)
      throw new Error(`Profile is already open: ${profileName}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      fs.unlinkSync(lockPath)
    }
  }
  const lock = fs.openSync(lockPath, 'wx')
  fs.writeFileSync(lock, String(process.pid))
  fs.closeSync(lock)
  let released = false
  let releaseSlot: (() => void) | undefined
  let budgetLost = false
  let liveSession: CamoufoxSession | undefined
  const release = () => {
    if (released) return
    released = true
    releaseSlot?.()
    fs.unlinkSync(lockPath)
  }
  try {
    releaseSlot = await acquireBrowserSlot(shutdownSignal, undefined, () => {
      budgetLost = true
      void liveSession?.close().catch(() => undefined)
    })
    const display = options.headless ? undefined : await allocateDisplay()
    let session: CamoufoxSession
    try {
      session = await launchSession(profileName, {
        ...options,
        display: display?.display ?? options.display,
      })
      liveSession = session
      if (budgetLost) {
        await session.close()
        throw new Error('Browser resource budget disconnected')
      }
    } catch (error) {
      await display?.close()
      throw error
    }
    session.context.once('close', release)
    session.context.once('close', () => {
      void display?.close().catch(() => undefined)
    })
    const close = session.close
    return {
      ...session,
      display,
      close: async () => {
        try {
          await close()
        } finally {
          await display?.close()
          release()
        }
      },
    }
  } catch (error) {
    release()
    throw error
  }
}
