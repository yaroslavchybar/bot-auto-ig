import { runtimeRequest } from '../shared/runtime.js'
import { routineOwnLikerPlan } from '../shared/convexClient.js'
import type { Page } from 'playwright-core'
import { ownUsername } from './follow-back.js'
import { smoothScroll } from './actions/scroll.js'
import type { ActionLogger } from './actions/shared.js'
import type { BrowseSession } from './actions/session.js'

/** The native scraper reads only this profile's saved cookies and proxy, never the scraper pool. */
export async function scanOwnPostLikers(
  automationId: string,
  profileId: string,
  page: Page,
  session: BrowseSession,
  log: ActionLogger,
) {
  session.check()
  const plan = await routineOwnLikerPlan(automationId, profileId)
  if (!plan) return
  const ownerIgId = (await page.context().cookies('https://www.instagram.com/')).find(
    (cookie) => cookie.name === 'ds_user_id',
  )?.value
  if (ownerIgId !== plan.ownerIgId)
    throw new Error('The browser is not signed into the post-owning profile')
  const posts = await discoverOwnPosts(page, session)
  session.check()
  const result = await runtimeRequest<{
    ok: boolean
    scanned?: boolean
    queued?: number
    posts?: number
    error?: string
  }>('/scraper/own-post-likers', {
    method: 'POST',
    body: JSON.stringify({ automationId, profileId, ownerIgId, posts }),
    signal: AbortSignal.timeout(session.timeout(90_000)),
  })
  if (!result.ok) throw new Error(result.error ?? 'Own-post liker scan failed')
  if (result.scanned)
    log({
      event: 'automation.routine.own_post_likers',
      postCount: result.posts,
      queuedCount: result.queued,
    })
}

export async function discoverOwnPosts(page: Page, session: BrowseSession) {
  const username = await ownUsername(page)
  session.check()
  await page.goto(`https://www.instagram.com/${username}/`, {
    waitUntil: 'domcontentloaded',
    timeout: session.timeout(20_000),
  })
  await page
    .locator('main header')
    .getByRole('link', { name: username, exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: session.timeout(15_000) })
  const tiles = page.locator(
    `main a[href^="/${username}/p/"], main a[href^="/${username}/reel/"], main a[href^="/p/"], main a[href^="/reel/"]`,
  )
  await tiles
    .first()
    .or(page.getByText('No posts yet', { exact: true }))
    .first()
    .waitFor({ state: 'visible', timeout: session.timeout(15_000) })
  const codes = new Set<string>()
  let previous = '',
    stable = 0
  for (let step = 0; step < 100; step++) {
    session.check()
    if (new URL(page.url()).pathname.toLowerCase() !== `/${username.toLowerCase()}/`)
      throw new Error('Own-profile navigation changed')
    for (const href of await tiles.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('href') ?? ''),
    )) {
      const match = href.match(/^\/(?:[\w.]+\/)?(?:p|reel)\/([A-Za-z0-9_-]+)\/$/)
      if (match) codes.add(match[1])
    }
    const state = await page.evaluate(() => {
      const scroll = document.scrollingElement!
      return {
        bottom: scroll.scrollTop + innerHeight >= scroll.scrollHeight - 4,
        height: scroll.scrollHeight,
        loading: !!document.querySelector('main [role="progressbar"]'),
        viewport: innerHeight,
      }
    })
    const signature = `${codes.size}:${state.height}`
    stable = !state.loading && signature === previous ? stable + 1 : 0
    if (state.bottom && stable >= 2)
      return [...codes].map((code) => ({ id: mediaIdFromCode(code), code }))
    previous = signature
    const viewport = page.viewportSize()
    if (viewport) await page.mouse.move(viewport.width / 2, viewport.height * 0.7)
    await smoothScroll(page, state.viewport * 0.8, session)
    await session.wait(500)
  }
  throw new Error('Own-post discovery did not finish')
}

export function mediaIdFromCode(code: string) {
  if (!/^[A-Za-z0-9_-]{1,11}$/.test(code)) throw new Error('Invalid Instagram post shortcode')
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let id = 0n
  for (const char of code) id = id * 64n + BigInt(alphabet.indexOf(char))
  return id.toString()
}
