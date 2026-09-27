import { openBrowserSession } from '../browser/cloak.js'
import { randomUUID } from 'node:crypto'
import { freshAuthenticatorCode } from '../chat/totp.js'
import { InstagramChat } from '../chat/instagram.js'
import { profilesGetById } from '../shared/convexClient.js'
import { watchIgLoginWork, type IgLoginWork } from '../shared/convexRealtime.js'
import { reactiveWork } from '../shared/reactiveWork.js'
import logger from '../shared/logger.js'
import { blacklistProxy, listBlacklistedProxies } from './blacklist.js'
import { listLoginProxies, proxyExit, savedProxyExit } from './proxies.js'
import { accountForProfile, claimLoginProxy, connectedNames,
  recordBrowserLogin, releaseLoginProxy, setAccountState, type StoredAccount } from './store.js'
import { profileNameSyncPending, syncConnectedProfileName } from './profileName.js'
import { loginProxyCooldownMs } from './loginTiming.js'
import type { Page } from 'playwright-core'

const active = new Set<string>()
const activeProxyIds = new Set<string>()
const activeExitIps = new Set<string>()

class LoginRejected extends Error {}

/** Claim in Convex before yielding, so other workers cannot start on this proxy. */
async function* loginCandidates(country: string, accountId: string) {
  const blocked = new Set((await listBlacklistedProxies()).map(row => row.ip))
  const seen = new Set<string>()
  for (const row of await listLoginProxies()) {
    if (row.country !== country || (row.loginCooldownUntil ?? 0) > Date.now() ||
      activeProxyIds.has(row._id)) continue
    let exit: Awaited<ReturnType<typeof proxyExit>>
    try { exit = await proxyExit(row.proxy) }
    catch { continue }
    if (exit.country !== country || blocked.has(exit.ip) || seen.has(exit.ip) ||
      activeProxyIds.has(row._id) || activeExitIps.has(exit.ip)) continue
    const claimToken = randomUUID()
    if (!await claimLoginProxy(accountId, row._id, claimToken)) continue
    seen.add(exit.ip)
    activeProxyIds.add(row._id)
    activeExitIps.add(exit.ip)
    try { yield { id: row._id, proxy: row.proxy, name: row.name, exit, claimToken } }
    finally {
      activeProxyIds.delete(row._id)
      activeExitIps.delete(exit.ip)
      try { await releaseLoginProxy(accountId, row._id, claimToken) }
      catch { logger.warn({ proxyId: row._id }, 'Could not release Login proxy claim; it will expire') }
    }
  }
}

async function browserLogin(page: Page, account: StoredAccount): Promise<void> {
  await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded', timeout: 45_000 })
  const username = page.locator('input[name="username"]')
  const password = page.locator('input[name="password"]')
  await username.waitFor({ state: 'visible', timeout: 30_000 })
  await username.fill(account.username)
  await password.fill(account.password)
  await password.press('Enter')
  const deadline = Date.now() + 60_000
  let twoFactorSubmitted = false
  while (Date.now() < deadline) {
    const cookies = await page.context().cookies('https://www.instagram.com/')
    if (cookies.some(cookie => cookie.name === 'sessionid' && cookie.value)) return
    const body = (await page.locator('body').innerText().catch(() => '')).toLowerCase()
    if (/login information you entered is incorrect|username you entered doesn't appear to belong|incorrect password|password was incorrect/.test(body))
      throw new LoginRejected('Instagram rejected the login information')
    const code = page.locator('input[name="verificationCode"], input[name="security_code"], input[autocomplete="one-time-code"]').first()
    if (!twoFactorSubmitted && await code.isVisible().catch(() => false)) {
      await code.fill(await freshAuthenticatorCode(account.authenticatorKey))
      await code.press('Enter')
      twoFactorSubmitted = true
    }
    if (/suspicious login|confirm it was you|check your email|challenge required/.test(body))
      throw new Error('Instagram requires a manual challenge')
    await page.waitForTimeout(1_000)
  }
  throw new Error('Instagram login timed out without a confirmed session')
}

async function loginProfile(profileId: string, connectMobile = false): Promise<void> {
  const account = await accountForProfile(profileId)
  if (!account || account.status !== 'assigned') return
  const profile = await profilesGetById(profileId)
  if (!profile || profile.status === 'deleting') return
  if (account.browserLoggedInAt && !connectMobile) return
  if (connectMobile && profile.using) return
  try {
    if (!profile.igLoggedIn) {
      if (!profile.proxy) throw new Error('Profile has no permanent proxy')
      const country = (await savedProxyExit(profile.proxy)).country
      let rejected = 0
      let loginSucceeded = false
      for await (const candidate of loginCandidates(country, account.id)) {
        const session = await openBrowserSession(profile.name,
          { headless: true, proxyOverride: candidate.proxy })
        let browserSucceeded = false
        try {
          await browserLogin(session.page, account)
          browserSucceeded = true
        } catch (error) {
          if (error instanceof LoginRejected) {
            rejected++
            await blacklistProxy({ ip: candidate.exit.ip, country, proxyName: candidate.name,
              reason: 'Instagram rejected login', createdAt: Date.now() })
          } else throw error
        } finally { await session.close() }
        if (browserSucceeded) {
          const result = await recordBrowserLogin(account.id, Date.now(),
            candidate.id, candidate.claimToken, loginProxyCooldownMs())
          if (!result.cooldownRecorded)
            logger.warn({ proxyId: candidate.id }, 'Browser login succeeded after its proxy claim expired')
          loginSucceeded = true
        }
        if (loginSucceeded) break
        if (rejected >= 2) break
      }
      if (!loginSucceeded) {
        if (rejected >= 2) {
          await setAccountState(account.id, 'invalid', 'Instagram rejected login on two different proxy IPs')
          return
        }
        throw new Error(`No working Login proxy found in ${country.toUpperCase()}`)
      }
      return
    }
    if (!profile.proxy) throw new Error('Profile has no permanent Work proxy')
    // The mobile session uses the profile's permanent Work proxy.
    await InstagramChat.login(profile, account.username, account.password, account.authenticatorKey)
    await syncConnectedProfileName(profileId, account.id, account.username)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed'
    logger.warn({ profileId, error: message.replace(/https?:\/\/\S+/g, '[proxy]') }, 'IG account login paused')
    await setAccountState(account.id, 'assigned', message.replace(/https?:\/\/\S+/g, '[proxy]'), Date.now() + 60 * 60_000)
  }
}

export function queueProfileLogin(profileId: string): void {
  if (active.has(profileId)) return
  active.add(profileId)
  void loginProfile(profileId).catch(() => logger.warn({ profileId }, 'IG login worker failed'))
    .finally(() => active.delete(profileId))
}

/** Called by the model setup worker on day 3, before changing the username. */
export async function connectScheduledMobile(profileId: string): Promise<void> {
  if (active.has(profileId)) return
  active.add(profileId)
  try { await loginProfile(profileId, true) }
  finally { active.delete(profileId) }
}

export function startIgAccountWorker(): void {
  const work = reactiveWork<IgLoginWork>({
    dueAt: rows => rows.length ? Math.min(...rows.map(row => row.retryAfter)) : null,
    run: async () => {
      for (const row of pending) {
        if (row.retryAfter <= Date.now()) queueProfileLogin(row.profileId)
      }
    },
    onError: err => logger.warn({ err }, 'IG login worker failed'),
  })
  let pending: IgLoginWork = []
  const subscription = watchIgLoginWork(rows => { pending = rows; work.update(rows) }, err => {
    pending = []
    work.update([])
    logger.error({ err }, 'IG login subscription failed')
  })
  void subscription.initial.catch(() => undefined)

  const syncNames = async () => {
    try {
      for (const { account, profileName, renameFrom, profileStatus } of await connectedNames()) {
        try {
          if (account.profileId && profileName && !renameFrom && profileStatus !== 'deleting' &&
            (profileName !== account.username || profileNameSyncPending(account.error)))
            await syncConnectedProfileName(account.profileId, account.id, account.username)
        } catch {
          logger.warn({ profileId: account.profileId }, 'Could not sync connected IG account name')
        }
      }
    } catch { logger.warn('Could not scan connected IG accounts') }
  }
  void syncNames()
  setInterval(() => void syncNames(), 15 * 60_000).unref()
}
