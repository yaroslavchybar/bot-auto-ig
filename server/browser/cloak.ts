import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { launchPersistentContext } from 'cloakbrowser'
import { parseProxy, describeProxyLaunchError, BROWSER_WINDOW_WIDTH, BROWSER_WINDOW_HEIGHT } from './config.js'
import { shutdownSignal, sleep } from './lifecycle.js'
import { focusPageContent } from './focus.js'
import { acquireBrowserSlot } from './budget.js'
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

export type BrowserSession = {
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

// One-time reclaim: a directory from the Camoufox era holds only Firefox
// files, which Chromium ignores. Cookies live in the database, so on the
// first Cloak open the directory is wiped for the new engine. Later opens
// (cloak-seed.json present) hold live Chromium data and are never touched.
const FIREFOX_MARKERS = [
  'fingerprint.json',
  'xulstore.json',
  'prefs.js',
  'places.sqlite',
  'cookies.sqlite',
]

export function migrateFirefoxProfile(profileDir: string): void {
  if (fs.existsSync(path.join(profileDir, 'cloak-seed.json'))) return
  if (!FIREFOX_MARKERS.some((file) => fs.existsSync(path.join(profileDir, file)))) return
  for (const entry of fs.readdirSync(profileDir)) {
    // The caller holds worker.lock; never sweep it with migrated contents.
    if (entry === 'worker.lock') continue
    fs.rmSync(path.join(profileDir, entry), { recursive: true, force: true })
  }
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
  } catch (error) {
    // Browser shutdown must not hide the original action error, but a lost
    // cookie save must not report success either: the DB would keep stale auth.
    process.stderr.write(`Could not save browser session cookies: failed to ${stage}\n`)
    throw error
  }
}

type SessionOptions = { headless?: boolean; display?: string }

/** Cloak platform persona. mac stays mac, everything else runs as Windows. */
export function cloakPlatform(fingerprintOs: unknown): 'windows' | 'macos' {
  const os = String(fingerprintOs || '').trim().toLowerCase()
  return os === 'mac' || os === 'macos' ? 'macos' : 'windows'
}

/**
 * Deterministic fingerprint seed per profile + platform. Same seed returns
 * as a returning visitor; a random seed every launch looks like a new device.
 */
export function cloakSeed(profileDir: string, platform: string): number {
  const seedPath = path.join(profileDir, 'cloak-seed.json')
  try {
    const cached = JSON.parse(fs.readFileSync(seedPath, 'utf8'))
    if (cached.platform === platform && Number.isSafeInteger(cached.seed))
      return cached.seed
  } catch (error) {
    // A missing or corrupt seed file regenerates below. Anything with a
    // filesystem error code other than ENOENT (EACCES, EPERM, ...) is real
    // and propagates.
    if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const seed = crypto.randomInt(10000, 100000)
  fs.writeFileSync(seedPath, JSON.stringify({ platform, seed }))
  return seed
}

function browserOptions(profile: DbProfileRow, profileDir: string, options: SessionOptions) {
  const platform = cloakPlatform(profile.fingerprintOs)
  const seed = cloakSeed(profileDir, platform)
  const proxy = parseProxy(profile.proxy, profile.proxyType)
  return {
    userDataDir: profileDir,
    headless: options.headless ?? false,
    locale: 'en-US',
    // Viewport matches the VNC desktop geometry so window and page agree.
    viewport: { width: BROWSER_WINDOW_WIDTH, height: BROWSER_WINDOW_HEIGHT },
    args: [
      `--fingerprint=${seed}`,
      `--fingerprint-platform=${platform}`,
      `--fingerprint-screen-width=${BROWSER_WINDOW_WIDTH}`,
      `--fingerprint-screen-height=${BROWSER_WINDOW_HEIGHT}`,
    ],
    proxy,
    geoip: Boolean(proxy),
    // Behavioral stealth: human mouse curves, typing rhythm, scroll shape.
    humanize: true as const,
    humanPreset: 'careful' as const,
    ...(process.env.CLOAKBROWSER_LICENSE_KEY
      ? { licenseKey: process.env.CLOAKBROWSER_LICENSE_KEY }
      : {}),
    // lifecycle.ts owns signals and saves cookies before closing.
    launchOptions: {
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      ...(options.display
        ? { env: { ...process.env, DISPLAY: options.display } }
        : {}),
    },
  }
}

/** Rejects if the launch hangs (proxy stalls, transport wedges) so a stuck
 *  launch can never wedge the runner forever. The hung attempt holds no
 *  seat yet, so timing out is always safe. */
const LAUNCH_TIMEOUT_MS = 90_000

function withLaunchTimeout<T extends { close?: () => Promise<unknown> }>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  let timedOut = false
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      reject(new Error('Browser launch timed out'))
    }, LAUNCH_TIMEOUT_MS)
  })
  // A launch that resolves after the timeout already lost the race: close the
  // orphaned browser so it cannot hold the license seat.
  void promise.then(
    async (result) => {
      if (!timedOut) return
      try { await result?.close?.() } catch { /* orphan already gone */ }
    },
    () => undefined,
  )
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
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

export async function openBrowserSession(
  profileName: string,
  options: SessionOptions = {},
): Promise<BrowserSession> {
  shutdownSignal.throwIfAborted()
  const profileDir = profilePath(profileName)
  const releaseLock = lockProfile(profileDir)
  // Migrate only while holding the lock: concurrent openers serialize here
  // instead of racing the directory wipe.
  migrateFirefoxProfile(profileDir)
  let releaseSlot: (() => void) | undefined
  let display: Display | undefined
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
    checkStartup()
    // The license seat can lag a few seconds behind a clean close. Retry a
    // genuinely-held seat briefly instead of failing the run over timing.
    let launchError: unknown
    for (let attempt = 0; attempt < 4; attempt++) {
      checkStartup()
      try {
        // Cloak speaks native SOCKS5 with inline credentials, no local relay.
        context = await withLaunchTimeout(launchPersistentContext(launchOptions))
        launchError = undefined
        break
      } catch (error) {
        launchError = error
        const message = error instanceof Error ? error.message : String(error)
        if (!/session limit|concurrent session/i.test(message) || attempt === 3) break
        process.stderr.write(`Cloak session seat busy, retrying (${attempt + 1}/3)...\n`)
        await sleep(10_000)
      }
    }
    if (!context) {
      throw describeProxyLaunchError(profile.name, launchOptions.proxy, launchError)
    }
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
    // New windows open with the address bar focused. Blurs it into the page
    // and parks the cursor over content so wheel/keys hit the feed, not chrome.
    await focusPageContent(page)
    checkStartup()
    ready = true
    return { context, page, profile, display, close, closed }
  } catch (error) {
    // Complete partial startup cleanup without replacing the startup error.
    await close().catch(() => undefined)
    throw error
  }
}
