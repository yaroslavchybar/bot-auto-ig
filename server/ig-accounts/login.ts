import { BrowserLaunchTimeout, openBrowserSession } from '../browser/cloak.js'
import { freshAuthenticatorCode, type ChatCredentials } from '../chat/totp.js'
import type { Page } from 'playwright-core'

class LoginRejected extends Error {}

const active = new Map<string, { controller: AbortController; done: Promise<boolean> }>()
const retired = new Map<string, { expires: number; cleanupFailed: boolean }>()
let stopping = false

/** Stop new logins and drain every browser before either runtime exits. */
export async function shutdownBrowserLogins(): Promise<void> {
  stopping = true
  const results = await Promise.allSettled([...active.keys()].map(cancelBrowserLogin))
  const errors = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
  if (errors.length) throw new AggregateError(errors, 'Browser login shutdown failed')
}

function retire(attemptId: string): void {
  const now = Date.now()
  for (const [id, value] of retired) if (value.expires <= now && !active.has(id)) retired.delete(id)
  if (!retired.has(attemptId) && retired.size >= 1000)
    throw new Error('Browser login attempt capacity reached')
  retired.set(attemptId, {
    expires: now + 15 * 60_000,
    cleanupFailed: retired.get(attemptId)?.cleanupFailed ?? false,
  })
}

/** Acknowledge cancellation only after the browser releases its resources. */
export async function cancelBrowserLogin(attemptId: string): Promise<void> {
  retire(attemptId)
  const attempt = active.get(attemptId)
  if (attempt) {
    attempt.controller.abort(new Error('Browser login cancelled'))
    if (!(await attempt.done)) throw new Error('Browser login cleanup failed')
  }
  if (retired.get(attemptId)?.cleanupFailed) throw new Error('Browser login cleanup failed')
}

async function browserLogin(
  page: Page,
  account: ChatCredentials,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()
  await page.goto('https://www.instagram.com/accounts/login/', {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  })
  const username = page.locator('input[name="username"]')
  const password = page.locator('input[name="password"]')
  await username.waitFor({ state: 'visible', timeout: 30_000 })
  signal.throwIfAborted()
  await username.fill(account.username)
  signal.throwIfAborted()
  await password.fill(account.password)
  signal.throwIfAborted()
  await password.press('Enter')
  const deadline = Date.now() + 60_000
  let twoFactorSubmitted = false
  while (Date.now() < deadline) {
    signal.throwIfAborted()
    const cookies = await page.context().cookies('https://www.instagram.com/')
    if (cookies.some((cookie) => cookie.name === 'sessionid' && cookie.value)) return
    const body = (
      await page
        .locator('body')
        .innerText()
        .catch(() => '')
    ).toLowerCase()
    signal.throwIfAborted()
    if (
      /login information you entered is incorrect|username you entered doesn't appear to belong|incorrect password|password was incorrect/.test(
        body,
      )
    )
      throw new LoginRejected('Instagram rejected the login information')
    const code = page
      .locator(
        'input[name="verificationCode"], input[name="security_code"], input[autocomplete="one-time-code"]',
      )
      .first()
    if (!twoFactorSubmitted && (await code.isVisible().catch(() => false))) {
      const authenticatorCode = await freshAuthenticatorCode(account.authenticatorKey)
      signal.throwIfAborted()
      await code.fill(authenticatorCode)
      signal.throwIfAborted()
      await code.press('Enter')
      twoFactorSubmitted = true
    }
    if (/suspicious login|confirm it was you|check your email|challenge required/.test(body))
      throw new Error('Instagram requires a manual challenge')
    await page.waitForTimeout(1_000)
  }
  throw new Error('Instagram login timed out without a confirmed session')
}

/** Rust owns retries and proxy claims; this callback only runs the browser action. */
export async function runBrowserLogin(
  attemptId: string,
  profileName: string,
  proxy: string,
  account: ChatCredentials,
): Promise<{ ok: true } | { rejected: true }> {
  if (stopping) throw new Error('Browser login worker is stopping')
  if (active.has(attemptId) || (retired.get(attemptId)?.expires ?? 0) > Date.now())
    throw new Error('Browser login attempt already ended or started')
  if (active.size >= 16) throw new Error('Browser login capacity reached')
  retire(attemptId)
  const controller = new AbortController()
  let finish!: (cleaned: boolean) => void
  const done = new Promise<boolean>((resolve) => {
    finish = resolve
  })
  let cleanupFailed = false
  let pendingCleanup: Promise<void> | undefined
  const finishAttempt = (cleaned: boolean) => {
    active.delete(attemptId)
    if (!cleaned) retired.get(attemptId)!.cleanupFailed = true
    finish(cleaned)
  }
  active.set(attemptId, { controller, done })
  try {
    const session = await openBrowserSession(profileName, {
      headless: true,
      proxyOverride: proxy,
      signal: controller.signal,
    })
    try {
      await browserLogin(session.page, account, controller.signal)
      controller.signal.throwIfAborted()
      return { ok: true }
    } catch (error) {
      controller.signal.throwIfAborted()
      if (error instanceof LoginRejected) return { rejected: true }
      throw error
    } finally {
      await session.close().catch((error) => {
        cleanupFailed = true
        throw error
      })
    }
  } catch (error) {
    if (error instanceof BrowserLaunchTimeout) pendingCleanup = error.cleanup
    // Startup reports an aggregate error when its cleanup also failed.
    if (error instanceof AggregateError) cleanupFailed = true
    throw error
  } finally {
    if (pendingCleanup)
      void pendingCleanup.then(() => finishAttempt(true), () => finishAttempt(false))
    else finishAttempt(!cleanupFailed)
  }
}
