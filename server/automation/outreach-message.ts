import type { Locator, Page } from 'playwright-core'
import { messageButton } from './follow.js'
import { clickAction } from './actions/action-locator.js'
import { BrowseSession } from './actions/session.js'
import { random } from './actions/shared.js'
import { currentLogScope } from '../shared/logger.js'

const editorSelector = '[role="textbox"][contenteditable="true"]'

// Find a recipient's chat across nested controls. One editor and one Close
// control keep shared containers from matching a neighboring chat during loading.
export const outreachMessagePopup = (page: Page, username: string) => {
  const paths = [`/${username}/`, `/${username}`]
  const hrefs = paths.flatMap(path => [path, `https://www.instagram.com${path}`, `https://instagram.com${path}`])
  const recipient = page.locator(`a:is(${hrefs.map(href => `[href="${href}" i]`).join(',')})`)
  const closeControl = './/*[@role="button" or self::button][@aria-label="Close" or .//*[@aria-label="Close"]]'
  return page.locator(editorSelector)
    .locator(`xpath=ancestor::div[count(${closeControl})=1][count(.//*[@role="textbox"][@contenteditable="true"])=1]`)
    .filter({ has: recipient }).filter({ visible: true }).last()
}

export async function openOutreachMessage(page: Page, username: string, session: BrowseSession): Promise<Locator> {
  session.check()
  await clickAction(messageButton(page), session.timeout(15_000))
  const popup = outreachMessagePopup(page, username)
  const composer = popup.locator(editorSelector)
  try {
    await composer.waitFor({ state: 'visible', timeout: session.timeout(20_000) })
  } catch (error) {
    // Log structure only, never conversation contents or screenshots.
    const diagnostics = await Promise.allSettled([
      page.locator(editorSelector).filter({ visible: true }).count(), popup.count(),
    ])
    currentLogScope()?.add({
      dmEditorCount: diagnostics[0].status === 'fulfilled' ? diagnostics[0].value : undefined,
      dmRecipientPopupCount: diagnostics[1].status === 'fulfilled' ? diagnostics[1].value : undefined,
      dmPageKind: new URL(page.url()).pathname.startsWith('/direct/') ? 'inbox' : 'profile',
    })
    throw error
  }
  return composer
}

/** Keyboard events preserve the editor's state; Shift+Enter never sends a multiline draft. */
export async function typeOutreachMessage(composer: Locator, message: string, session: BrowseSession) {
  session.check()
  // Cloak cannot resolve chained keyboard locators. Its page keyboard supports
  // natural typing directly; keep the selected editor pinned and verify focus.
  const input = await composer.elementHandle({ timeout: session.timeout(5000) })
  if (!input) throw new Error('Message editor is detached or missing')
  const keyboard = composer.page().keyboard
  const checkFocus = async () => {
    session.check()
    if (!await input.evaluate(node => node.isConnected && node.ownerDocument.activeElement === node))
      throw new Error('Message editor lost keyboard focus')
  }
  try {
    await clickAction(composer, session.timeout(10_000))
    await checkFocus()
    await keyboard.press('ControlOrMeta+A')
    await checkFocus()
    await keyboard.press('Backspace')
    const draft = message.replace(/\r\n?/g, '\n')
    for (const character of draft) {
      await checkFocus()
      if (character === '\n') await keyboard.press('Shift+Enter')
      else await keyboard.type(character, { delay: random(40, 110) })
    }
    session.check()
    const actual = (await input.innerText()).replace(/\r\n?/g, '\n')
    // Lexical leaves a line-break paragraph in an empty editor.
    if (draft ? actual !== draft : actual.trim() !== '')
      throw new Error('Message draft does not match the prepared text')
  } finally {
    await input.dispose().catch(() => {})
  }
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
