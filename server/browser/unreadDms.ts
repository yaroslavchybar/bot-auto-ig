import { errors, type Page } from 'playwright-core'

/** Read the badge on Instagram's inbox navigation link without opening messages. */
export async function readUnreadDms(page: Page): Promise<number | null> {
  const inbox = page.locator('a[href="/direct/inbox/"]')
  // The inbox link is only rendered for a logged-in account.
  await inbox.waitFor({ state: 'visible', timeout: 15_000 })

  const badge = inbox.locator('[aria-label^="Direct messaging - "]')
  // A missing badge can mean zero, but it can also mean Instagram has not loaded it yet.
  try {
    await badge.waitFor({ state: 'attached', timeout: 2_500 })
  } catch (error) {
    if (error instanceof errors.TimeoutError) return null
    throw error
  }

  const label = await badge.getAttribute('aria-label')
  const match = /^Direct messaging - (\d{1,3}(?:,\d{3})*|\d+)(?=\s)/.exec(label ?? '')
  if (!match) throw new Error('Unread DM badge has an unknown format')
  const count = Number(match[1].replaceAll(',', ''))
  if (!Number.isSafeInteger(count)) throw new Error('Unread DM badge count is too large')
  return count
}
