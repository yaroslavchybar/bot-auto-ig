import type { Page } from 'playwright-core'
import { BrowseSession } from './session.js'
import { random, type ActionLogger, type StopCheck } from './shared.js'
import { clickVisible, driftMouse, hoverPost } from './mouse.js'
import { revealForClick, scrollModal } from './scroll.js'
import { closeDialog, dismissPopups } from './navigation.js'
import { openOwnProfile } from './profiles.js'

export type FeedImage = { name: string; mimeType: string; buffer: Buffer }

const CREATE_BUTTON = 'a:has(svg[aria-label="New post"]), [role="button"]:has(svg[aria-label="New post"])'
const FILE_INPUT = 'input[type="file"]'
const DIALOG = 'div[role="dialog"]'
const POST_MENU_ITEM = 'text=/^Post$/'
const CROP_MENU_BUTTON = `${DIALOG} [aria-label="Select crop"]`
const FIRST_POST_LINK = 'main a[href*="/p/"]'

// Clicks must stay single-engine (plain CSS, text=, xpath): the humanized
// clicker rejects :has-text/:text-is and chained (>>) locators.
const dialogButton = (label: 'Next' | 'Share' | 'Done' | 'Original'): string => `text=/^${label}$/`
const LIKE_BUTTON = 'xpath=//div[@role="dialog"]//*[@aria-label="Like"]'
const UNLIKE_ICON = 'xpath=//div[@role="dialog"]//*[@aria-label="Unlike"]'

async function dialogVisible(page: Page, text: string, session: BrowseSession, max = 10_000): Promise<boolean> {
  try {
    await page.locator(`${DIALOG}:has-text("${text}")`).first()
      .waitFor({ state: 'visible', timeout: session.timeout(max) })
    return true
  } catch {
    return false
  }
}

async function clickDialogButton(page: Page, label: 'Next' | 'Share' | 'Done', session: BrowseSession): Promise<boolean> {
  session.check()
  await hoverPost(page, page.locator(dialogButton(label)).first())
  return clickVisible(page, dialogButton(label), session)
}

// Hover first so the cursor travels like a feed browse before every dialog click.
async function clickHuman(page: Page, selector: string, session: BrowseSession): Promise<boolean> {
  session.check()
  await hoverPost(page, page.locator(selector).first())
  return clickVisible(page, selector, session)
}

async function openCreateDialog(page: Page, log: ActionLogger, session: BrowseSession): Promise<boolean> {
  session.check()
  await driftMouse(page, undefined, undefined, session).catch(() => undefined)
  if (!await clickHuman(page, CREATE_BUTTON, session)) {
    log('Post publish skipped: no Create button')
    return false
  }
  await session.wait(random(800, 1500))
  if (await dialogVisible(page, 'Create new post', session, 5_000)) return true
  // Create sometimes opens a Post / Live video / Ad menu instead of the dialog.
  // "Live video" only exists in that menu: confirm it before touching any Post button.
  const menu = page.locator(':text-is("Live video")').first()
  if (await menu.isVisible().catch(() => false)) {
    if (await clickHuman(page, POST_MENU_ITEM, session)) {
      if (await dialogVisible(page, 'Create new post', session)) return true
    }
  }
  log('Post publish skipped: create dialog did not open')
  return false
}

async function attachImage(page: Page, image: FeedImage, log: ActionLogger, session: BrowseSession): Promise<boolean> {
  session.check()
  const inputs = page.locator(DIALOG).locator(FILE_INPUT)
  await inputs.first().waitFor({ state: 'attached', timeout: session.timeout(15_000) }).catch(() => undefined)
  if ((await inputs.count().catch(() => 0)) === 0) {
    log('Post publish skipped: no file input')
    return false
  }
  await inputs.first().setInputFiles([{ name: image.name, mimeType: image.mimeType, buffer: image.buffer }],
    { timeout: session.timeout(30_000) }).catch(() => undefined)
  if (!await dialogVisible(page, 'Crop', session)) {
    log('Post publish skipped: crop screen did not open')
    return false
  }
  return true
}

async function chooseOriginalCrop(page: Page, log: ActionLogger, session: BrowseSession): Promise<boolean> {
  session.check()
  let picked = false
  for (let attempt = 0; attempt < 2 && !picked; attempt++) {
    const original = page.locator(dialogButton('Original')).first()
    if (await original.isVisible().catch(() => false)) {
      picked = await clickHuman(page, dialogButton('Original'), session)
    }
    if (!picked) {
      await clickHuman(page, CROP_MENU_BUTTON, session)
      await session.wait(random(500, 1000))
    }
  }
  log(picked ? 'Original ratio selected' : 'Keeping default crop: no Original option')
  if (!await clickDialogButton(page, 'Next', session)) {
    log('Post publish skipped: could not leave crop screen')
    return false
  }
  if (!await dialogVisible(page, 'Edit', session)) {
    log('Post publish skipped: edit screen did not open')
    return false
  }
  if (!await clickDialogButton(page, 'Next', session)) {
    log('Post publish skipped: could not leave edit screen')
    return false
  }
  return true
}

async function sharePost(page: Page, log: ActionLogger, session: BrowseSession): Promise<boolean> {
  session.check()
  if (!await dialogVisible(page, 'Create new post', session)) {
    log('Post publish skipped: share screen did not open')
    return false
  }
  if (!await clickDialogButton(page, 'Share', session)) {
    log('Post publish skipped: no Share button')
    return false
  }
  try {
    await page.locator(`${DIALOG}:has-text("Your post has been shared")`).first()
      .waitFor({ state: 'visible', timeout: session.timeout(60_000) })
  } catch {
    log('Post publish failed: share did not confirm')
    return false
  }
  log('Post shared')
  await clickDialogButton(page, 'Done', session).catch(() => false)
  return true
}

async function likeNewPost(page: Page, log: ActionLogger, session: BrowseSession): Promise<void> {
  session.check()
  // The share confirmation can linger over the sidebar and hide the avatar.
  await closeDialog(page, session).catch(() => undefined)
  if (!await openOwnProfile(page, log, session)) {
    log('Own like skipped: own profile did not open')
    return
  }
  const link = page.locator(FIRST_POST_LINK).first()
  await link.waitFor({ state: 'visible', timeout: session.timeout(10_000) }).catch(() => undefined)
  // The grid shifts while thumbnails load; settle it before tapping.
  let opened = false
  for (let attempt = 0; attempt < 3 && !opened; attempt++) {
    session.check()
    await hoverPost(page, link)
    await revealForClick(page, link, session).catch(() => false)
    await link.click({ timeout: session.timeout(5_000) }).catch(() => undefined)
    await session.wait(random(1200, 2500))
    opened = await page.locator(DIALOG).first().isVisible().catch(() => false)
  }
  if (!opened) {
    log('Own like skipped: new post did not open')
    return
  }
  if ((await page.locator(UNLIKE_ICON).count().catch(() => 0)) > 0) {
    log('Post already liked')
    await closeDialog(page, session).catch(() => undefined)
    return
  }
  await scrollModal(page, page.locator(DIALOG).first(), 2, session)
  if (await clickHuman(page, LIKE_BUTTON, session)) {
    await page.locator(UNLIKE_ICON).first()
      .waitFor({ state: 'visible', timeout: session.timeout(5_000) }).catch(() => undefined)
    if ((await page.locator(UNLIKE_ICON).count().catch(() => 0)) > 0) log('Liked own post')
  }
  await closeDialog(page, session).catch(() => undefined)
}

/** Profile page → Create → upload → Original → Next → Share → open post → like. True when shared. */
export async function publishFeedPost(
  page: Page,
  image: FeedImage,
  log: ActionLogger,
  shouldStop: StopCheck,
  end = Infinity,
  session = new BrowseSession(end, shouldStop),
): Promise<boolean> {
  session.check()
  await dismissPopups(page, session).catch(() => false)
  await page.locator('a:has(svg[aria-label="Home"])').first()
    .waitFor({ state: 'visible', timeout: session.timeout(20_000) }).catch(() => undefined)
  if (!await openOwnProfile(page, log, session)) {
    log('Post publish skipped: own profile did not open')
    return false
  }
  if (!await openCreateDialog(page, log, session)) return false
  if (!await attachImage(page, image, log, session)) return false
  if (!await chooseOriginalCrop(page, log, session)) return false
  if (!await sharePost(page, log, session)) return false
  await likeNewPost(page, log, session).catch(() => undefined)
  return true
}
