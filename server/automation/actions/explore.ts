import type { Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { actionLocator, clickAction } from './action-locator.js'
import { assertInstagramReady } from './instagram-state.js'
import { BrowseSession } from './session.js'
import { random } from './shared.js'

/** Open Instagram's Search screen, type into its field, and submit through the keyboard. */
export async function searchExplore(page: Page, query: string, session: BrowseSession): Promise<boolean> {
  session.check()
  if (!query.trim()) return false
  const search = page.locator('a:has(svg[aria-label="Search"])').filter({ visible: true }).first()
  if (!await search.isVisible()) return false
  await clickAction(search, session.timeout(5000))
  const input = page.getByRole('textbox', { name: 'Search input', exact: true })
  await input.waitFor({ state: 'visible', timeout: session.timeout(10_000) })
  await (await actionLocator(input, session.timeout(5000))).fill(query, { timeout: session.timeout(5000) })
  await session.wait(random(600, 1200))
  await page.keyboard.press('Enter')
  await session.wait(random(1000, 1800))
  await assertInstagramReady(page)
  return true
}

/** The current desktop UI exposes topic post grids through its hashtag suggestions. */
export async function openTopicResults(page: Page, topic: string, session: BrowseSession): Promise<boolean> {
  const tag = topic.replace(/[^\p{L}\p{N}_]/gu, '').toLowerCase()
  if (!tag || !await searchExplore(page, `#${tag}`, session)) return false
  const suggestions = page.locator('main a[href^="/explore/tags/"]').filter({ visible: true })
  try { await suggestions.first().waitFor({ state: 'visible', timeout: session.timeout(6000) }) }
  catch (error) {
    if (!(error instanceof errors.TimeoutError)) throw error
    session.check(); await assertInstagramReady(page)
    return false
  }
  const hrefs = await suggestions.evaluateAll(links => links.map(link => link.getAttribute('href')).filter((href): href is string => !!href))
  const candidates = hrefs.filter(href => /^\/explore\/tags\/[^/]+\/$/.test(href))
  const exact = `/explore/tags/${encodeURIComponent(tag)}/`
  const href = candidates.includes(exact) ? exact : candidates[0]
  if (!href) return false
  // Native suggestions may add an emoji or a suffix. Classify the actual posts before engaging.
  const result = page.locator(`main a[href=${JSON.stringify(href)}]`).filter({ visible: true }).first()
  await clickAction(result, session.timeout(5000))
  await page.locator('main a[href*="/p/"], main a[href*="/reel/"]').first()
    .waitFor({ state: 'visible', timeout: session.timeout(10_000) })
  await assertInstagramReady(page)
  return true
}

/** Click only the requested username's result; similarly named accounts never qualify. */
export async function openProfileThroughSearch(page: Page, username: string, session: BrowseSession): Promise<boolean> {
  username = username.toLowerCase()
  if (!/^[\w.]{1,30}$/.test(username)) return false
  if (!await searchExplore(page, username, session)) return false
  const result = page.locator(`main a[href=${JSON.stringify(`/${username}/`)}]`)
    .filter({ visible: true }).filter({ hasText: username }).first()
  try { await result.waitFor({ state: 'visible', timeout: session.timeout(6000) }) }
  catch (error) {
    if (!(error instanceof errors.TimeoutError)) throw error
    session.check(); await assertInstagramReady(page)
    return false
  }
  await clickAction(result, session.timeout(5000))
  await page.waitForURL(url => ['www.instagram.com', 'instagram.com'].includes(url.hostname)
    && url.pathname.toLowerCase() === `/${username.toLowerCase()}/`, { timeout: session.timeout(10_000) })
  await page.locator('main header').waitFor({ state: 'visible', timeout: session.timeout(8000) })
  await assertInstagramReady(page)
  return true
}
