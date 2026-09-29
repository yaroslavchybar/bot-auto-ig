import type { Locator, Page } from 'playwright-core'
import { StealthDomError } from 'cloakbrowser/human'
import { random, type ActionLogger } from './shared.js'
import { BrowseSession } from './session.js'

function isInstagramConsentPage(page: Page): boolean {
  try {
    const url = new URL(page.url())
    return url.hostname === 'www.instagram.com' && url.pathname === '/consent/'
  } catch {
    return false
  }
}

function consentControl(page: Page, label: string): Locator {
  const text = JSON.stringify(label)
  return page.locator([
    `button:has-text(${text})`,
    `[role="button"]:has-text(${text})`,
    `[role="radio"]:has-text(${text})`,
    `label:has-text(${text})`,
    `a:has-text(${text})`,
  ].join(', '))
}

// Instagram can redirect Home to a multi-page consent flow. Choose the
// free, less-personalized path and only click controls on that flow.
async function dismissConsent(page: Page, session: BrowseSession): Promise<boolean> {
  if (!isInstagramConsentPage(page)) return false
  const clicked = new Set<string>()
  while (isInstagramConsentPage(page)) {
    session.check()
    // Cloak's humanized click supports CSS selectors, but not getByRole.
    const steps = [
      ['cookies', 'Decline optional cookies'],
      ['intro', 'Get started'],
      ['free', 'Use free of charge with ads'],
      ['continue', 'Continue'],
      ['agree', 'Agree'],
      ['less', 'Switch to less-personalized ads'],
      ['ok', 'OK'],
      ['confirm', 'Confirm'],
    ] as const
    let advanced = false
    for (const [name, label] of steps) {
      if (clicked.has(name) ||
        (name === 'continue' && !clicked.has('free')) ||
        (name === 'ok' && !clicked.has('less'))) continue
      // This heading also identifies a resumed flow that opened directly on
      // the agreement screen, where this call did not click Continue.
      if (name === 'agree' && !await page.getByText(/To use our products free of charge with ads, agree to/i)
        .first().isVisible().catch(() => false)) continue
      if (name === 'confirm' && !await page.getByText("Here's what to expect with less-personalized ads", { exact: true })
        .first().isVisible().catch(() => false)) continue
      const controls = consentControl(page, label)
      const count = await controls.count().catch(() => 0)
      for (let i = 0; i < count; i++) {
        const button = controls.nth(i)
        if (!await button.isVisible().catch(() => false) || !await button.isEnabled().catch(() => false)) continue
        // Choice cards include descriptions; the other controls must match in full.
        const text = (await button.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
        const choiceLabel = (name === 'free' || name === 'less') &&
          await button.getByText(label, { exact: true }).count().catch(() => 0) > 0
        if (text !== label && !choiceLabel) continue
        session.check()
        try {
          await button.click({ timeout: session.timeout(2_000) })
        } catch (error) {
          if (error instanceof StealthDomError) throw error
          continue
        }
        clicked.add(name)
        advanced = true
        if (!isInstagramConsentPage(page)) return true
        await session.wait(random(400, 700))
        break
      }
      if (advanced) break
    }
    if (!advanced) await session.wait(500)
  }
  return clicked.size > 0
}

// Handles consent screens and "Not Now" popups. Returns true after dismissal.
export async function dismissPopups(page: Page, session = new BrowseSession(Date.now() + 15_000)): Promise<boolean> {
  session.check()
  const consentClicked = await dismissConsent(page, session)
  if (consentClicked && isInstagramConsentPage(page)) return false
  const buttons = page.locator('[role="dialog"] button:has-text("Not Now"), [role="dialog"] [role="button"]:has-text("Not Now")')
  const count = await buttons.count().catch(() => 0)
  let visible = 0
  for (let i = 0; i < count && visible < 3; i++) {
    const button = buttons.nth(i)
    if (!await button.isVisible().catch(() => false)) continue
    visible++
    session.check()
    // Keep the clicked dialog's handle; another Not Now button may shift into this index.
    const popup = await button.locator('xpath=ancestor::*[@role="dialog"][1]')
      .elementHandle({ timeout: session.timeout(1_000) }).catch(() => null)
    if (!popup) continue
    try {
      try {
        await button.click({ timeout: session.timeout(2_000) })
      } catch {
        continue
      }
      await session.wait(random(300, 700)).catch(() => undefined)
      const dismissed = await popup.waitForElementState('hidden', { timeout: session.timeout(1_500) })
        .then(() => true, () => false)
      if (dismissed) return true
    } finally {
      await popup.dispose().catch(() => undefined)
    }
  }
  return consentClicked
}

export async function closeDialog(page: Page, session = new BrowseSession()): Promise<void> {
  const sleep = session.wait
  session.check()
  // X button first (real <button> with Close icon); Escape as fallback.
  try {
    const dialog = page.locator('div[role="dialog"]').first()
    const scope = (await dialog.isVisible().catch(() => false)) ? dialog : page
    const x = scope.locator('svg[aria-label="Close"]').first()
    if (await x.isVisible().catch(() => false)) {
      await x.click({ timeout: session.timeout(5_000) })
      await sleep(random(400, 900))
      return
    }
  } catch {
  }
  session.check()
  await page.keyboard.press('Escape').catch(() => undefined)
  await sleep(random(300, 700))
}

// Sidebar Home button. True if home loaded.
async function goHomeViaUi(page: Page, session: BrowseSession): Promise<boolean> {
  const sleep = session.wait
  session.check()
  try {
    const home = page.locator('a:has(svg[aria-label="Home"])').first()
    if (!(await home.isVisible().catch(() => false))) return false
    await home.click({ timeout: session.timeout(5_000) })
    await page
      .waitForURL(/instagram\.com\/(\?.*)?$/, { timeout: session.timeout(10_000) })
      .catch(() => undefined)
    await sleep(random(1200, 2500))
    return /instagram\.com\/(\?.*)?$/.test(page.url())
  } catch {
    return false
  }
}

// Back to feed the human way: browser Back (Alt+Left, same as the back
// button) until the feed shows, then sidebar Home. Direct goto last resort.
export async function backToFeed(page: Page, log: ActionLogger, session = new BrowseSession()): Promise<void> {
  const sleep = session.wait
  session.check()
  for (let i = 0; i < 3; i++) {
    if (/instagram\.com\/(\?.*)?$/.test(page.url())) {
      const posts = await page.locator('article').count().catch(() => 0)
      if (posts > 0) {
        if (i > 0) log({ event: 'automation.actions.navigation.went_back_to_feed', message: 'Went back to feed' })
        return
      }
    }
    session.check()
    await page.keyboard.press('Alt+ArrowLeft').catch(() => undefined)
    await sleep(random(1500, 2500))
  }
  if (await goHomeViaUi(page, session).catch(() => false)) return
  await page
    .goto('https://www.instagram.com/', {
      waitUntil: 'domcontentloaded',
      timeout: session.timeout(30_000),
    })
    .catch(() => undefined)
}
