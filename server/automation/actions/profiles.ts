import type { Locator, Page } from 'playwright-core'
import { BrowseSession } from './session.js'
import { random, type ActionLogger, type StopCheck } from './shared.js'
import { isUserHref, PROFILE_URL } from './guards.js'
import { clickVisible } from './mouse.js'
import { revealForClick, scrollModal, smoothScroll } from './scroll.js'
import { closeDialog } from './navigation.js'

// First user link in the post is the author (avatar/username row).
export async function openAuthorProfile(page: Page, target: Locator, session = new BrowseSession()): Promise<boolean> {
  const sleep = session.wait
  session.check()
  try {
    const link = target.locator('a[href^="/"]').first()
    if (!isUserHref(await link.getAttribute('href').catch(() => null)))
      return false
    // Author row below the fold: glide it into view, then tap it.
    await revealForClick(page, link, session).catch(() => false)
    if (!(await link.isVisible().catch(() => false))) return false
    await link.click({ timeout: session.timeout(5_000) })
    await sleep(random(1200, 2500))
    return PROFILE_URL.test(page.url())
  } catch {
    return false
  }
}

// Random user row from an open dialog (likers / commenters).
async function pickDialogUser(page: Page, session: BrowseSession): Promise<boolean> {
  const sleep = session.wait
  session.check()
  const dialog = page.locator('div[role="dialog"]').first()
  await dialog.waitFor({ state: 'visible', timeout: session.timeout(8_000) }).catch(() => undefined)
  if (!(await dialog.isVisible().catch(() => false))) return false
  await sleep(random(800, 1500))
  await scrollModal(page, dialog, Math.round(random(2, 4)), session)
  const rows = dialog.locator('a[href^="/"]')
  // List loads after the shell; wait for rows before reading them.
  await rows.first().waitFor({ state: 'attached', timeout: session.timeout(8_000) }).catch(() => undefined)
  // Username (text) links navigate reliably; avatar-only links can miss.
  for (let attempt = 0; attempt < 3; attempt++) {
    const n = await rows.count().catch(() => 0)
    const picks: number[] = []
    for (let i = 0; i < n && picks.length < 10; i++) {
      const row = rows.nth(i)
      const href = await row.getAttribute('href').catch(() => null)
      const text = await row.textContent().catch(() => '')
      if (isUserHref(href) && (text || '').trim().length > 0) picks.push(i)
    }
    if (!picks.length) break
    const target = rows.nth(picks[Math.floor(Math.random() * picks.length)])
    // Glide the row into view inside the dialog instead of jump-scrolling.
    await revealForClick(page, target, session).catch(() => false)
    await sleep(random(300, 700))
    await Promise.all([
      page.waitForURL(PROFILE_URL, { timeout: session.timeout(8_000) }).catch(() => undefined),
      target.click({ timeout: session.timeout(5_000) }).catch(() => undefined),
    ])
    if (PROFILE_URL.test(page.url())) return true
    if (!(await dialog.isVisible().catch(() => false))) {
      await closeDialog(page, session)
      return false
    }
  }
  await closeDialog(page, session)
  return false
}

// Likes count span → likers dialog → random liker.
async function openLikersProfile(page: Page, target: Locator, session = new BrowseSession()): Promise<boolean> {
  session.check()
  try {
    const likers = target
      .locator('span[role="button"]', { hasText: /^[\d\s.,KMB]+$/ })
      .first()
    if (!(await likers.isVisible().catch(() => false))) return false
    await likers.click({ timeout: session.timeout(5_000) })
    return await pickDialogUser(page, session)
  } catch {
    await closeDialog(page, session).catch(() => undefined)
    return false
  }
}

// Comment icon → post page → random commenter (or dialog, if one opened).
async function openCommentsProfile(page: Page, target: Locator, session = new BrowseSession()): Promise<boolean> {
  const sleep = session.wait
  session.check()
  try {
    const icon = target
      .locator('div[role="button"]:has(svg[aria-label="Comment"])')
      .first()
    if (!(await icon.isVisible().catch(() => false))) return false
    await icon.click({ timeout: session.timeout(5_000) })
    await sleep(random(2000, 3000))
    if (await page.locator('div[role="dialog"]').first().isVisible().catch(() => false))
      return await pickDialogUser(page, session)
    if (!/\/p\/|\/reel\//.test(page.url())) {
      // Popup opened but unusable — close it instead of leaving it hanging.
      await closeDialog(page, session)
      return false
    }
    // Scroll through the comments like reading them before picking someone.
    try {
      const artBox = await page.locator('article').first().boundingBox()
      if (artBox) {
        const vpH = page.viewportSize()?.height ?? 800
        await page.mouse.move(
          artBox.x + artBox.width * random(0.6, 0.85),
          Math.min(Math.max(artBox.y + 300, 100), vpH - 100),
        )
      }
      const looks = Math.round(random(2, 3))
      for (let i = 0; i < looks; i++) {
        await smoothScroll(page, random(250, 500), session)
        await sleep(random(600, 1200))
      }
    } catch {
      // Still pick from whatever is visible.
    }
    // Post page: the profile the post is from (author header) or a commenter.
    const links = page.locator('article a[href^="/"]')
    const n = await links.count().catch(() => 0)
    const authors: number[] = []
    const commenters: number[] = []
    for (let i = 0; i < n && authors.length + commenters.length < 10; i++) {
      if (!isUserHref(await links.nth(i).getAttribute('href').catch(() => null)))
        continue
      if (i === 0) authors.push(i)
      else commenters.push(i)
    }
    // Author header half the time, else a random commenter.
    const pool =
      authors.length && (commenters.length === 0 || Math.random() < 0.5)
        ? authors
        : commenters
    if (!pool.length) {
      await closeDialog(page, session)
      return false
    }
    await links
      .nth(pool[Math.floor(Math.random() * pool.length)])
      .click({ timeout: session.timeout(5_000) })
    await sleep(random(1200, 2500))
    return PROFILE_URL.test(page.url())
  } catch {
    await closeDialog(page, session).catch(() => undefined)
    return false
  }
}

export async function openVisitorProfile(page: Page, target: Locator, session = new BrowseSession()): Promise<boolean> {
  session.check()
  if (await openLikersProfile(page, target, session)) return true
  return openCommentsProfile(page, target, session)
}

// Own profile via the sidebar avatar button. UI only, no direct navigation.
export async function openOwnProfile(page: Page, log: ActionLogger, session = new BrowseSession()): Promise<boolean> {
  const sleep = session.wait
  session.check()
  try {
    // Sidebar avatar has an aria-selected wrapper; feed avatars do not.
    const own = page.locator('a[href^="/"]:has([aria-selected] img[alt$="profile picture"])').first()
    if (!(await own.isVisible().catch(() => false))) return false
    await own.click({ timeout: session.timeout(5_000) })
    await page.waitForURL(PROFILE_URL, { timeout: session.timeout(10_000) }).catch(() => undefined)
    await sleep(random(1200, 2500))
    if (!PROFILE_URL.test(page.url())) return false
    log('Checking own profile')
    return true
  } catch {
    return false
  }
}

// Look around a profile: scroll grid, maybe a highlight and one post.
// Best effort throughout; any failure just ends the detour.
export async function wanderProfile(
  page: Page,
  log: ActionLogger,
  shouldStop: StopCheck,
  end: number,
  session = new BrowseSession(end, shouldStop),
): Promise<void> {
  const sleep = session.wait
  session.check()
  const rounds = Math.round(random(2, 4))
  for (let i = 0; i < rounds && Date.now() < end && !shouldStop(); i++) {
    await smoothScroll(page, random(400, 800), session)
    await sleep(random(700, 1600))
  }
  if (Date.now() >= end || shouldStop()) return
  // Random highlight when several; first visible wins if the tray overflows.
  const hlLinks = page.locator('main a[href^="/stories/highlights/"]')
  const hlCount = Math.min(await hlLinks.count().catch(() => 0), 10)
  const hlOrder = Array.from({ length: hlCount }, (_, i) => i).sort(
    () => Math.random() - 0.5,
  )
  for (const idx of hlOrder) {
    if (Date.now() >= end || shouldStop()) return
    const highlight = hlLinks.nth(idx)
    if (!(await highlight.isVisible().catch(() => false))) continue
    await highlight.click({ timeout: session.timeout(5_000) }).catch(() => undefined)
    await sleep(random(2500, 5000))
    if (Math.random() < 0.5)
      await clickVisible(page, '[aria-label*="Next"], button:has-text("Next")', session).catch(
        () => undefined,
      )
    await sleep(random(1500, 3000))
    await closeDialog(page, session)
    await sleep(random(600, 1200))
    log('Watched a highlight')
    break
  }
  if (Date.now() >= end || shouldStop()) return
  // Open a few grid posts and look at each one.
  const postOpens = Math.round(random(1, 3))
  let opened = 0
  for (
    let i = 0;
    i < 12 && opened < postOpens && Date.now() < end && !shouldStop();
    i++
  ) {
    const link = page
      .locator('main a[href^="/p/"], main a[href^="/reel/"]')
      .nth(i)
    if (!(await link.isVisible().catch(() => false))) continue
    await link.click({ timeout: session.timeout(5_000) }).catch(() => undefined)
    await sleep(random(1200, 2200))
    if (
      await page
        .locator('div[role="dialog"]')
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await sleep(random(2000, 4000))
      await closeDialog(page, session)
    } else if (/\/p\/|\/reel\//.test(page.url())) {
      await sleep(random(2000, 4000))
      await page.keyboard.press('Alt+ArrowLeft').catch(() => undefined)
      await sleep(random(1200, 2200))
    } else {
      continue
    }
    opened++
    await sleep(random(500, 1000))
  }
  if (Date.now() >= end || shouldStop()) return
  // Glance back up smoothly before leaving, like a human would.
  const upGlides = Math.round(random(2, 4))
  for (let i = 0; i < upGlides && Date.now() < end && !shouldStop(); i++) {
    await smoothScroll(page, -random(350, 650), session)
    await sleep(random(400, 900))
  }
}
