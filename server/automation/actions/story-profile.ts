import type { Page } from 'playwright-core'
import type { WarmupActivityBudget } from '../../shared/warmupPlan.js'
import { clickLiveAction } from './action-locator.js'
import { scrollPostComments } from './comments.js'
import { visitAuthorProfile } from './profiles.js'
import type { BrowseSession } from './session.js'
import type { ActionLogger } from './shared.js'

const playback = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first()
const dependencies = { click: clickLiveAction, visit: visitAuthorProfile, comments: scrollPostComments }

/** Story visits browse media and comments without Likes, then use mouse Back and resume playback. */
export async function visitStoryProfile(page: Page, owner: string, session: BrowseSession, log: ActionLogger,
  budget: WarmupActivityBudget, deps = dependencies): Promise<void> {
  const previous = page.url()
  const pause = playback(page, 'Pause')
  const play = playback(page, 'Play')
  try {
    if (await pause.isVisible()) {
      await deps.click(page, pause, session)
      await play.waitFor({ state: 'visible', timeout: session.timeout(2000) })
    }
    if (page.url() !== previous || !await play.isVisible()) return
    // The deepest shared container is the active Story header, not a preview or the Home feed behind it.
    const header = page.locator('div').filter({ has: page.locator(`a[href="/${owner}/"]`),
      hasText: owner }).filter({ has: page.locator('svg[aria-label="Play"]') }).last()
    if (!await header.isVisible() || !budget.take('profiles')) return
    await deps.visit(page, header, log, session, undefined, async (article, visiting) => {
      budget.browsed++; budget.used.reels++
      await deps.comments(page, article, visiting)
      log({ event: 'automation.engagement.comments_read', source: 'story_profile' })
    })
  } finally {
    if (!session.stopped() && page.url() === previous && await play.isVisible()) await deps.click(page, play, session)
  }
}
