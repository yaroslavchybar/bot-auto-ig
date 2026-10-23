import type { Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { isTemporaryUiError } from './ui-errors.js'
import { focusPageContent } from '../../browser/focus.js'
import { chance, type ActionLogger, type StopCheck } from './shared.js'
import { dismissPopups, isInstagramHome } from './navigation.js'
import { BrowseSession, SessionEnded } from './session.js'
import { actionLocator, clickLiveAction } from './action-locator.js'
import { assertInstagramReady } from './instagram-state.js'
import type { WarmupActivityBudget } from '../../shared/warmupPlan.js'
import { visitStoryProfile } from './story-profile.js'
import { withUiDiagnosticContext } from './ui-diagnostics.js'

export const UNSEEN_STORY_SELECTOR = 'main [role="button"][aria-label^="Story by "][aria-label$=", not seen"]:not([aria-disabled="true"])'

/** Capture the initial tray before startup checks or Explore navigate away. */
export async function hasUnseenStories(page: Page, session: BrowseSession): Promise<boolean> {
  session.check()
  try {
    await withUiDiagnosticContext({ expectedTimeout: true, session }, () => page.locator(`${UNSEEN_STORY_SELECTOR}:visible`).first().waitFor({
      state: 'visible', timeout: session.timeout(2000),
    }))
    session.check()
    return true
  } catch (error) {
    session.check()
    if (!(error instanceof errors.TimeoutError)) throw error
    return false
  }
}

const storyPath = (page: Page) => {
  const path = new URL(page.url()).pathname
  const owner = /^\/stories\/([\w.]+)\//.exec(path)?.[1]
  return owner ? { path, owner: owner.toLowerCase() } : null
}

/** Instagram's active segment slides its fill from -100% to 0%; neighboring previews have no progress row. */
export function storyProgress(nodes: Element[]): { index: number; total: number; progress: number } | null {
  for (const node of nodes) {
    const track = node.parentElement, row = track?.parentElement, view = node.ownerDocument.defaultView!
    if (!track || !row) continue
    const box = track.getBoundingClientRect()
    if (box.height < 1 || box.height > 4 || box.width < 10 || box.top < 0 || box.bottom > view.innerHeight ||
      box.right <= 0 || box.left >= view.innerWidth || view.getComputedStyle(node).visibility === 'hidden') continue
    const offset = /^translateX\((-?[\d.]+)%\)$/.exec((node as HTMLElement).style.transform)
    if (!offset) continue
    return { index: [...row.children].indexOf(track), total: row.children.length,
      progress: Math.max(0, Math.min(1, 1 + Number(offset[1]) / 100)) }
  }
  return null
}

const progressSelector = 'div[style*="translateX("]'
const control = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first()

const dependencies = {
  progress: (page: Page) => page.locator(progressSelector).evaluateAll(storyProgress),
  click: clickLiveAction,
  wait: (session: BrowseSession, ms: number) => session.wait(ms),
  chance, visit: visitStoryProfile,
}

async function closeStoryViewer(page: Page, click: typeof clickLiveAction, shouldStop: StopCheck, log: ActionLogger): Promise<void> {
  if (shouldStop()) return
  const cleanup = new BrowseSession(Date.now() + 10_000, shouldStop)
  try {
    if (!storyPath(page)) return
    const close = control(page, 'Close')
    if (!await close.isVisible()) return
    cleanup.check()
    await click(page, close, cleanup)
    await page.waitForURL(url => !url.pathname.startsWith('/stories/'), { timeout: cleanup.timeout(3000) })
  } catch (error) {
    // Cleanup must never hide the primary failure or continue input after a stop.
    if (!shouldStop()) log({ event: 'automation.actions.stories.cleanup_failed', error })
  }
}

export async function watchStories(
  page: Page,
  maxStories: number,
  log: ActionLogger,
  shouldStop: StopCheck,
  timing: { deadline?: number; sessionDeadline?: number; budget?: WarmupActivityBudget } = {},
  deps = dependencies,
): Promise<number> {
  const watchUntil = timing.deadline ?? Infinity
  const session = new BrowseSession(timing.sessionDeadline ?? watchUntil, shouldStop)
  const unlimited = maxStories === Infinity
  if (unlimited && !Number.isFinite(session.end)) throw new Error('Watching all stories requires a deadline')
  let watched = 0, opened = false
  try {
    session.check()
    if (!isInstagramHome(page)) await page.goto('https://www.instagram.com/', {
      waitUntil: 'domcontentloaded', timeout: session.timeout(45_000),
    })
    await focusPageContent(page)
    await dismissPopups(page, new BrowseSession(Math.min(session.end, Date.now() + 15_000), shouldStop))
    const unseen = page.locator(UNSEEN_STORY_SELECTOR)
    const story = page.locator(`${UNSEEN_STORY_SELECTOR}:visible`).first()
    const opening = new BrowseSession(Math.min(Date.now() + 15_000, session.end), shouldStop)
    try {
      await story.waitFor({ state: 'visible', timeout: opening.timeout(2000) })
      opening.check()
    } catch (error) {
      if (!(error instanceof SessionEnded) && !(error instanceof errors.TimeoutError)) throw error
      log({ event: 'automation.actions.stories.no_unseen_stories', outcome: 'skipped' })
      return 0
    }
    if (!(await story.isVisible().catch(() => false))) {
      log({ event: 'automation.actions.stories.no_unseen_stories', outcome: 'skipped' })
      return 0
    }
    opening.check()
    const owners = maxStories > 0 ? new Set(await unseen.evaluateAll(nodes => nodes.flatMap(node => {
      const owner = /^Story by ([\w.]+), not seen$/.exec(node.getAttribute('aria-label') ?? '')?.[1]
      return owner ? [owner.toLowerCase()] : []
    }))) : new Set<string>()
    opened = true
    await (await actionLocator(story, opening.timeout(5_000))).click({ timeout: opening.timeout(5_000) })
    if (maxStories > 0) await page.waitForURL(url => /^\/stories\/[\w.]+\//.test(url.pathname), { timeout: session.timeout(5000) })
    const seen = new Set<string>(), profileChecked = new Set<string>()
    while (watched < Math.max(0, maxStories) && Date.now() < watchUntil && !shouldStop()) {
      await assertInstagramReady(page, session)
      const current = storyPath(page)
      if (!current || !owners.has(current.owner)) break
      let progress = await deps.progress(page)
      // Media and its progress row may still be loading after the viewer opens.
      for (let tries = 0; !progress && tries < 25 && storyPath(page)?.owner === current.owner; tries++) {
        await deps.wait(session, 200)
        progress = await deps.progress(page)
      }
      if (!progress) break
      const key = `${current.owner}:${progress.index}/${progress.total}`
      if (seen.has(key)) break
      let viewing = new BrowseSession(Math.min(session.end, Date.now() + 90_000), () => session.stopped())
      let complete = false
      try {
        while (!complete) {
          viewing.check()
          const next = storyPath(page), state = await deps.progress(page)
          // Autoplay is also completion evidence, including same-owner stories whose URL stays unchanged.
          if (!next || next.owner !== current.owner || state && (state.index !== progress.index || state.total !== progress.total)) {
            complete = true
            break
          }
          if (state && state.progress >= 1) { complete = true; break }
          if (state && state.progress >= 0.15 && state.progress < 0.8 && !profileChecked.has(current.owner) &&
            Date.now() < watchUntil && session.end - Date.now() >= 45_000 && timing.budget?.remaining('profiles')) {
            profileChecked.add(current.owner)
            if (deps.chance(15)) {
              try { await deps.visit(page, current.owner, session, log, timing.budget) }
              catch (error) {
                session.check()
                await assertInstagramReady(page, session)
                if (!isTemporaryUiError(error)) throw error
                log({ event: 'automation.actions.stories.profile_skipped', error })
              }
              // Time spent on the profile is not stalled Story playback.
              viewing = new BrowseSession(Math.min(session.end, Date.now() + 90_000), () => session.stopped())
              continue
            }
          }
          const play = control(page, 'Play')
          if (await play.isVisible()) await deps.click(page, play, viewing)
          await deps.wait(viewing, 200)
        }
      } catch (error) {
        if (!(error instanceof SessionEnded)) throw error
        session.check()
        log({ event: 'automation.actions.stories.skipped', reason: 'playback_stalled', owner: current.owner })
      }
      if (shouldStop()) break
      if (complete) watched++
      seen.add(key)
      if (watched >= maxStories || Date.now() >= watchUntil) break
      // Give autoplay a chance before using Next, so a completed segment cannot skip the following one.
      let state = await deps.progress(page)
      for (let tries = 0; complete && tries < 5 && storyPath(page)?.owner === current.owner && state?.index === progress.index; tries++) {
        await deps.wait(session, 100)
        state = await deps.progress(page)
      }
      if (storyPath(page)?.owner !== current.owner || state && state.index !== progress.index) continue
      if (Date.now() >= watchUntil) break
      const next = control(page, 'Next')
      if (!await next.isVisible()) break
      await deps.click(page, next, session)
      // Wait for the button navigation to settle before examining the next story.
      for (let tries = 0; tries < 30 && storyPath(page)?.owner === current.owner; tries++) {
        const state = await deps.progress(page)
        if (state && state.index !== progress.index) break
        await deps.wait(session, 100)
      }
    }
  } catch (error) {
    // Optional stories own their deadline; chunk expiry must not finish warm-up.
    if (!(error instanceof SessionEnded) && !session.stopped()) {
      if (!isTemporaryUiError(error)) throw error
      await assertInstagramReady(page, session)
      log({ event: 'automation.actions.stories.skipped', error })
    }
  } finally {
    if (opened) await closeStoryViewer(page, deps.click, shouldStop, log)
  }
  log({ event: 'automation.stories_result', watchedCount: watched })
  return watched
}
