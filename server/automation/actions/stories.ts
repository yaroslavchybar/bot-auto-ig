import type { Page } from 'playwright-core'
import { focusPageContent } from '../../browser/focus.js'
import { randomDelay, type ActionLogger, type StopCheck } from './shared.js'
import { clickVisible } from './mouse.js'
import { dismissPopups } from './navigation.js'

export async function watchStories(
  page: Page,
  maxStories: number,
  log: ActionLogger,
  shouldStop: StopCheck,
  timing: { minSeconds: number; maxSeconds: number; deadline?: number } = { minSeconds: 2, maxSeconds: 5 },
): Promise<void> {
  await page.goto('https://www.instagram.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  })
  await focusPageContent(page)
  await dismissPopups(page)
  const story = page.locator('a[href*="/stories/"]').first()
  if (!(await story.isVisible().catch(() => false))) {
    log('Stories: no story tray found')
    return
  }
  await story.click()
  let watched = 0
  while (watched < Math.max(0, maxStories) && !shouldStop()) {
    const remaining = Math.max(0, ((timing.deadline ?? Infinity) - Date.now()) / 1000)
    if (remaining <= 0) break
    await randomDelay(
      Math.min(remaining, Math.max(0, timing.minSeconds)),
      Math.min(remaining, Math.max(0, timing.minSeconds, timing.maxSeconds)),
    )
    if (shouldStop()) break
    watched++
    await clickVisible(page, '[aria-label*="Next"], button:has-text("Next")')
  }
  await page.keyboard.press('Escape').catch(() => undefined)
  log(`Stories: watched ${watched}`)
}
