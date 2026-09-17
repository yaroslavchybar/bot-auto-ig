import type { Page } from 'playwright-core'
import { focusPageContent } from '../../browser/focus.js'
import { randomDelay, type ActionLogger, type StopCheck } from './shared.js'
import { clickVisible } from './mouse.js'

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
  await focusPageContent(page)
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
