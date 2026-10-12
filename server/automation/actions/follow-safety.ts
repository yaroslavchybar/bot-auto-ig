import type { Page } from 'playwright-core'
import { followingButton } from '../follow.js'
import { assertInstagramReady } from './instagram-state.js'

/** Follow warnings pause new follows for the day; checkpoint prompts still stop the session. */
export async function performProfileFollow(page: Page, allowed: () => Promise<boolean>,
  click: () => Promise<void>, confirmed: () => Promise<void>, pause: (reason: string) => Promise<unknown>, timeout = 15_000): Promise<boolean> {
  const suggestions = page.getByText('Suggested for you', { exact: true }).filter({ visible: true }).first()
  const hadSuggestions = await suggestions.isVisible()
  if (!await allowed()) return false
  await click()
  try {
    await followingButton(page).waitFor({ state: 'visible', timeout })
  } catch (error) {
    if (!(error instanceof Error) || !/timeout/i.test(`${error.name} ${error.message}`)) throw error
    await pause('Follow button did not finish loading or confirm the follow')
    return false
  }
  await assertInstagramReady(page)
  const label = await followingButton(page).innerText()
  const privateAccount = await page.getByText(/This (?:account|profile) is private/i, { exact: true }).isVisible()
  if (/^requested\b/i.test(label) && !privateAccount) {
    await pause('Requested appeared on an account without a private-account notice')
    return false
  }
  await confirmed()
  if (hadSuggestions && !await suggestions.isVisible()) await pause('Suggested accounts disappeared after following')
  return true
}
