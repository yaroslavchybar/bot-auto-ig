import type { Locator, Page } from 'playwright-core'
import { sleep } from '../browser/lifecycle.js'
import {
  instagramAccountUpdateMessage,
  instagramAccountUpdateStatus,
  instagramAccountsForProfile,
  instagramAccountsToMessage,
  messageTemplatesGet,
} from '../shared/convexClient.js'

export type ActionLogger = (message: string) => void
export type StopCheck = () => boolean

const random = (min: number, max: number) =>
  min + Math.random() * Math.max(0, max - min)
const chance = (value: unknown) =>
  Math.random() * 100 < Math.max(0, Math.min(100, Number(value) || 0))
const numeric = (value: unknown, fallback: number) =>
  value == null || !Number.isFinite(Number(value)) ? fallback : Number(value)

async function randomDelay(min: number, max: number): Promise<void> {
  await sleep(random(min, max) * 1000)
}

async function clickVisible(
  page: Page | Locator,
  selector: string,
): Promise<boolean> {
  const locator = 'locator' in page ? page.locator(selector) : page
  for (let i = 0; i < Math.min(await locator.count(), 5); i++) {
    const item = locator.nth(i)
    if (await item.isVisible().catch(() => false)) {
      await item.click({ timeout: 5_000 })
      return true
    }
  }
  return false
}

async function likeVisible(page: Page | Locator): Promise<boolean> {
  return clickVisible(page, 'svg[aria-label="Like"], button[aria-label="Like"]')
}

async function followVisible(page: Page | Locator): Promise<boolean> {
  return clickVisible(
    page,
    'button:text-is("Follow"), div[role="button"]:text-is("Follow"), button:text-is("Follow Back"), div[role="button"]:text-is("Follow Back")',
  )
}

export async function browseFeed(
  page: Page,
  minutes: number,
  config: Record<string, unknown>,
  log: ActionLogger,
  shouldStop: StopCheck,
): Promise<void> {
  await page.goto('https://www.instagram.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  })
  const end = Date.now() + Math.max(0, minutes) * 60_000
  log(`Starting feed session for ${minutes} minute(s)`)
  while (Date.now() < end && !shouldStop()) {
    const articles = page.locator('article')
    const count = await articles.count()
    if (count && chance(config.like_chance)) {
      await likeVisible(articles.first()).catch(() => undefined)
    }
    if (count && chance(config.follow_chance)) {
      await followVisible(articles.first()).catch(() => undefined)
    }
    await page.mouse.wheel(0, Math.round(random(350, 850)))
    await randomDelay(1.5, 4)
  }
  log('Feed session finished')
}

export async function browseReels(
  page: Page,
  minutes: number,
  config: Record<string, unknown>,
  log: ActionLogger,
  shouldStop: StopCheck,
): Promise<void> {
  await page.goto('https://www.instagram.com/reels/', {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  })
  const end = Date.now() + Math.max(0, minutes) * 60_000
  log(`Starting reels session for ${minutes} minute(s)`)
  while (Date.now() < end && !shouldStop()) {
    const skip = chance(config.reels_skip_chance)
    const minWatch = skip
      ? Number(config.reels_skip_min_time)
      : Number(config.reels_normal_min_time)
    const maxWatch = skip
      ? Number(config.reels_skip_max_time)
      : Number(config.reels_normal_max_time)
    await sleep(random(minWatch || 1, maxWatch || 3) * 1000)
    if (chance(config.reels_like_chance)) await likeVisible(page)
    if (chance(config.reels_follow_chance)) await followVisible(page)
    await clickVisible(
      page,
      '[aria-label*="Next Reel"], [aria-label*="next Reel"]',
    )
    await randomDelay(
      Number(config.reels_advance_min_seconds) || 1,
      Number(config.reels_advance_max_seconds) || 3,
    )
  }
  log('Reels session finished')
}

export async function watchStories(
  page: Page,
  maxStories: number,
  log: ActionLogger,
  shouldStop: StopCheck,
): Promise<void> {
  await page.goto('https://www.instagram.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  })
  const story = page.locator('a[href*="/stories/"]').first()
  if (!(await story.isVisible().catch(() => false))) {
    log('Stories: no story tray found')
    return
  }
  await story.click()
  let watched = 0
  while (watched < Math.max(0, maxStories) && !shouldStop()) {
    await randomDelay(2, 5)
    watched++
    await clickVisible(page, '[aria-label*="Next"], button:has-text("Next")')
  }
  await page.keyboard.press('Escape').catch(() => undefined)
  log(`Stories: watched ${watched}`)
}

async function processProfiles(
  page: Page,
  profileId: string,
  status: 'assigned' | 'subscribed',
  log: ActionLogger,
  shouldStop: StopCheck,
  action: (username: string) => Promise<boolean>,
  config: Record<string, unknown>,
): Promise<void> {
  const accounts = await instagramAccountsForProfile(profileId, status)
  const prefix = status === 'assigned' ? 'follow' : 'unfollow'
  const min = Math.max(0, Math.floor(numeric(config[`${prefix}_min_count`], 5)))
  const max = Math.max(
    min,
    Math.floor(numeric(config[`${prefix}_max_count`], 15)),
  )
  const limit = Math.floor(random(min, max + 1))
  let completed = 0
  for (const account of accounts) {
    if (shouldStop() || completed >= limit) break
    const username = String(account.user_name || '')
      .replace(/^@/, '')
      .trim()
    if (!username) continue
    if (await action(username)) {
      await instagramAccountUpdateStatus(
        account.id,
        status === 'assigned' ? 'subscribed' : 'unsubscribed',
      )
      completed++
    }
    if (completed < limit)
      await randomDelay(
        numeric(config[`${prefix}_min_delay_seconds`] ?? config.min_delay, 10),
        numeric(config[`${prefix}_max_delay_seconds`] ?? config.max_delay, 20),
      )
  }
}

export async function followUsers(
  page: Page,
  profileId: string,
  log: ActionLogger,
  shouldStop: StopCheck,
  config: Record<string, unknown> = {},
): Promise<void> {
  await processProfiles(
    page,
    profileId,
    'assigned',
    log,
    shouldStop,
    async (username) => {
      await page.goto(
        `https://www.instagram.com/${encodeURIComponent(username)}/`,
        { waitUntil: 'domcontentloaded', timeout: 20_000 },
      )
      const result = await followVisible(page)
      if (result) log(`Followed @${username}`)
      return result
    },
    config,
  )
}

export async function unfollowUsers(
  page: Page,
  profileId: string,
  log: ActionLogger,
  shouldStop: StopCheck,
  config: Record<string, unknown> = {},
): Promise<void> {
  await processProfiles(
    page,
    profileId,
    'subscribed',
    log,
    shouldStop,
    async (username) => {
      await page.goto(
        `https://www.instagram.com/${encodeURIComponent(username)}/`,
        { waitUntil: 'domcontentloaded', timeout: 20_000 },
      )
      const result = await clickVisible(
        page,
        'button:has-text("Following"), div[role="button"]:has-text("Following")',
      )
      if (result) {
        if (
          !(await clickVisible(
            page,
            'button:text-is("Unfollow"), div[role="button"]:text-is("Unfollow")',
          ))
        )
          return false
        log(`Unfollowed @${username}`)
      }
      return result
    },
    config,
  )
}

export async function approveRequests(
  page: Page,
  log: ActionLogger,
  shouldStop: StopCheck,
): Promise<void> {
  await page.goto('https://www.instagram.com/accounts/activity/', {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  })
  const buttons = page.locator(
    'button:has-text("Confirm"), div[role="button"]:has-text("Confirm")',
  )
  const count = await buttons.count()
  for (let i = 0; i < count && !shouldStop() && (await buttons.count()); i++) {
    await buttons.first().click()
    await randomDelay(1, 2)
  }
  log('Follow request approval finished')
}

export async function sendMessages(
  page: Page,
  profileId: string,
  log: ActionLogger,
  shouldStop: StopCheck,
  config: Record<string, unknown> = {},
): Promise<void> {
  const cooldown = config.messaging_cooldown_enabled
    ? Math.max(0, Number(config.messaging_cooldown_hours) || 0)
    : 0
  const targets = await instagramAccountsToMessage(profileId, cooldown)
  const templates = await messageTemplatesGet(
    String(config.template_kind || 'message'),
  )
  if (!templates.length) {
    log('Messaging skipped: no message templates configured')
    return
  }
  for (const target of targets) {
    if (shouldStop()) break
    const username = String(target.user_name || '')
      .replace(/^@/, '')
      .trim()
    if (!username) continue
    await page.goto(
      `https://www.instagram.com/${encodeURIComponent(username)}/`,
      { waitUntil: 'domcontentloaded', timeout: 20_000 },
    )
    if (
      await clickVisible(
        page,
        'button:has-text("Message"), div[role="button"]:has-text("Message")',
      )
    ) {
      const input = page.locator('textarea, [contenteditable="true"]').last()
      await input.fill(templates[Math.floor(Math.random() * templates.length)])
      await input.press('Enter')
      await instagramAccountUpdateMessage(username)
      log(`Sent message to @${username}`)
    }
    await randomDelay(2, 5)
  }
}
