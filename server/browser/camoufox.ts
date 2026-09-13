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
  closed: Promise<void>
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
  if (!profile.cookiesJson) return []
  try {
    const value = JSON.parse(profile.cookiesJson)
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
  let stage = 'read cookies from browser'
  try {
    const cookies = await context.cookies()
    const id = sessionId(cookies)
    if (!id && !profile.sessionId && cookies.length === 0) return
    stage = 'write cookies to database'
    await profilesUpdateByName(profile.name, {
      name: profile.name,
      cookiesJson: JSON.stringify(cookies),
      sessionId: id,
    })
  } catch {
    // Browser shutdown must not hide the original action error.
    process.stderr.write(`Could not save browser session cookies: failed to ${stage}\n`)
  }
}

type SessionOptions = { headless?: boolean; display?: string; userAgent?: string }

function browserOptions(profile: DbProfileRow, profileDir: string, options: SessionOptions) {
  const targetOs =
    profile.fingerprintOs === 'mac' || profile.fingerprintOs === 'macos'
      ? 'macos'
      : profile.fingerprintOs === 'linux'
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
  const proxy = parseProxy(profile.proxy, profile.proxyType)
  const launchOptions: Record<string, unknown> = {
    headless: options.headless ?? false,
    // lifecycle.ts handles these signals and saves cookies before closing.
    handleSIGINT: false,
    handleSIGTERM: false,
    user_data_dir: profileDir,
    os: targetOs,
    fingerprint,
    i_know_what_im_doing: true,
    proxy,
    geoip: Boolean(proxy),
    // Camoufox humanizes cursor motion (move/click trajectories) in C++.
    // A numeric value sets humanize:maxTime: up to ~2s per move for variance.
    // Scroll smoothness comes from small, dense wheel() ticks in actions.ts;
    // keep mouse.move() calls step-free so Camoufox owns the curve.
    humanize: 2.0,
    firefox_user_prefs: {
      // Match stock Firefox smooth-scroll behavior for wheel input.
      'general.smoothScroll': true,
      'general.smoothScroll.mouseWheel': true,
    },
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

  return launchOptions
}

/** A profile directory can belong to only one worker, including during startup. */
function lockProfile(profileDir: string): () => void {
  const lockPath = path.join(profileDir, 'worker.lock')
  if (fs.existsSync(lockPath)) {
    const pid = Number(fs.readFileSync(lockPath, 'utf8'))
    if (!Number.isSafeInteger(pid) || pid <= 0)
      throw new Error('Invalid profile lock')
    try {
      process.kill(pid, 0)
      throw new Error(`Profile is already open: ${path.basename(profileDir)}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      fs.unlinkSync(lockPath)
    }
  }
  const lock = fs.openSync(lockPath, 'wx')
  fs.writeFileSync(lock, String(process.pid))
  fs.closeSync(lock)
  return () => fs.unlinkSync(lockPath)
}

export async function openCamoufoxSession(
  profileName: string,
  options: SessionOptions = {},
): Promise<CamoufoxSession> {
  shutdownSignal.throwIfAborted()
  const profileDir = profilePath(profileName)
  const releaseLock = lockProfile(profileDir)
  let releaseSlot: (() => void) | undefined
  let display: Display | undefined
  let preparedProxy: Awaited<ReturnType<typeof prepareBrowserProxy>> | undefined
  let context: BrowserContext | undefined
  let profile: DbProfileRow | undefined
  let ready = false
  let browserClosed = false
  let budgetLost = false
  let closing: Promise<void> | undefined
  let resolveClosed!: () => void
  let rejectClosed!: (error: unknown) => void
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve
    rejectClosed = reject
  })
  // Automation callers await close(); manual callers await closed.
  void closed.catch(() => undefined)

  const close = (): Promise<void> => {
    // Defer work so reentrant browser events see the same shutdown promise.
    closing ??= Promise.resolve().then(async () => {
      shutdownSignal.removeEventListener('abort', requestClose)
      const errors: unknown[] = []
      const steps = [
        () => ready && !browserClosed && profile && context ? saveSession(profile, context) : undefined,
        () => !browserClosed ? context?.close() : undefined,
        () => preparedProxy?.close(),
        () => display?.close(),
        releaseLock,
        () => releaseSlot?.(),
      ]
      for (const step of steps) {
        try { await step() } catch (error) { errors.push(error) }
      }
      if (errors.length) throw new AggregateError(errors, 'Browser cleanup failed')
    })
    closing.then(resolveClosed, rejectClosed)
    return closing
  }
  const requestClose = () => { void close().catch(() => undefined) }
  const checkStartup = () => {
    shutdownSignal.throwIfAborted()
    if (budgetLost) throw new Error('Browser resource budget disconnected')
    if (browserClosed) throw new Error('Browser closed during startup')
  }

  try {
    releaseSlot = await acquireBrowserSlot(shutdownSignal, undefined, () => {
      budgetLost = true
      if (context) requestClose()
    })
    checkStartup()
    profile = await profilesGetByName(profileName) ?? undefined
    if (!profile) throw new Error(`Profile not found: ${profileName}`)
    checkStartup()
    display = options.headless ? undefined : await allocateDisplay()
    checkStartup()
    const launchOptions = browserOptions(profile, profileDir, {
      ...options, display: display?.display ?? options.display,
    })
    preparedProxy = await prepareBrowserProxy(parseProxy(profile.proxy, profile.proxyType))
    checkStartup()
    context = (await Camoufox({ ...launchOptions, proxy: preparedProxy.proxy })) as BrowserContext
    context.once('close', () => {
      browserClosed = true
      requestClose()
    })
    // All resources are acquired; shutdown can now interrupt page initialization.
    shutdownSignal.addEventListener('abort', requestClose, { once: true })
    checkStartup()
    const cookies = storedCookies(profile)
    if (cookies.length) await context.addCookies(cookies)
    else if (profile.sessionId)
      await context.addCookies([
        {
          name: 'sessionid',
          value: profile.sessionId,
          domain: '.instagram.com',
          path: '/',
          secure: true,
          httpOnly: true,
          sameSite: 'None',
        },
      ])
    const page = context.pages()[0] || (await context.newPage())
    if (page.url() === 'about:blank') {
      await page.goto('https://www.instagram.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      })
    }
    checkStartup()
    ready = true
    return { context, page, profile, display, close, closed }
  } catch (error) {
    // Complete partial startup cleanup without replacing the startup error.
    await close().catch(() => undefined)
    throw error
  }
}
