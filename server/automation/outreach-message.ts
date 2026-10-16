import type { Locator, Page } from 'playwright-core'
import { messageButton } from './follow.js'
import { clickAction } from './actions/action-locator.js'
import { BrowseSession } from './actions/session.js'
import { random } from './actions/shared.js'

// Bind every DM action to the recipient's chat, including when other chats are open.
export const outreachMessagePopup = (page: Page, username: string) => page.locator(
  `[data-pagelet="IGDChatTabsRootContentOffMsys"]:has(a[aria-label="Open the profile page of ${username}"][href="/${username}/"])`,
).filter({ visible: true }).last()

export async function openOutreachMessage(page: Page, username: string, session: BrowseSession): Promise<Locator> {
  session.check()
  await clickAction(messageButton(page), session.timeout(15_000))
  const composer = outreachMessagePopup(page, username).locator('[role="textbox"][contenteditable="true"]')
  await composer.waitFor({ state: 'visible', timeout: session.timeout(20_000) })
  return composer
}

/** Keyboard events preserve the editor's state; Shift+Enter never sends a multiline draft. */
export async function typeOutreachMessage(composer: Locator, message: string, session: BrowseSession) {
  session.check()
  await clickAction(composer, session.timeout(10_000))
  await composer.press('ControlOrMeta+A', { timeout: session.timeout(5000) })
  await composer.press('Backspace', { timeout: session.timeout(5000) })
  const draft = message.replace(/\r\n?/g, '\n')
  for (const character of draft) {
    session.check()
    if (character === '\n') await composer.press('Shift+Enter', { timeout: session.timeout(5000) })
    else await composer.pressSequentially(character, { delay: random(40, 110), timeout: session.timeout(5000) })
  }
  if ((await composer.innerText({ timeout: session.timeout(5000) })).replace(/\r\n?/g, '\n') !== draft)
    throw new Error('Message draft does not match the prepared text')
}

export async function sendOutreachMessage(page: Page, username: string, session: BrowseSession) {
  session.check()
  await clickAction(outreachMessagePopup(page, username).getByRole('button', { name: 'Send', exact: true }), session.timeout(10_000))
}

export async function closeOutreachMessage(page: Page, username: string, session: BrowseSession) {
  session.check()
  const popup = outreachMessagePopup(page, username)
  if (!await popup.isVisible()) return
  await clickAction(popup.getByRole('button', { name: 'Close', exact: true }), session.timeout(10_000))
  await popup.waitFor({ state: 'hidden', timeout: session.timeout(5000) })
}
