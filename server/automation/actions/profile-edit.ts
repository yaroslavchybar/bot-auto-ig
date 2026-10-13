import type { Page } from 'playwright-core'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { actionLocator, clickAction } from './action-locator.js'
import { assertInstagramReady } from './instagram-state.js'
import { dismissPopups } from './navigation.js'
import { openOwnProfile } from './profiles.js'
import { BrowseSession } from './session.js'
import type { ActionLogger, StopCheck } from './shared.js'

export type ProfileEditTask = {
  kind: 'username' | 'fullName' | 'avatar'
  currentUsername: string
  value?: string
  path?: string
}
export type ProfileEditResult = 'applied' | 'unavailable' | 'failed' | 'uncertain'

async function returnToInstagram(page: Page, session: BrowseSession): Promise<void> {
  if (new URL(page.url()).hostname !== 'accountscenter.instagram.com') return
  const dialog = page.getByRole('dialog').filter({ visible: true }).first()
  if (await dialog.isVisible().catch(() => false))
    await clickAction(
      dialog.getByRole('button', { name: 'Close', exact: true }),
      session.timeout(5_000),
    )
  const back = page.getByRole('button', { name: 'Back to Instagram Settings', exact: true })
  await back.waitFor({ state: 'visible', timeout: session.timeout(10_000) })
  await clickAction(back, session.timeout(5_000))
  await page.waitForURL((url) => url.hostname === 'www.instagram.com', {
    timeout: session.timeout(20_000),
  })
}

/** Use the current browser's own account; never edit another Accounts Center profile. */
export async function editProfileInBrowser(
  page: Page,
  task: ProfileEditTask,
  log: ActionLogger,
  shouldStop: StopCheck,
): Promise<ProfileEditResult> {
  const session = new BrowseSession(Date.now() + 120_000, shouldStop)
  const currentUsername = task.currentUsername.toLowerCase()
  let submitted = false
  try {
    session.check()
    await returnToInstagram(page, session)
    await assertInstagramReady(page, session)
    await dismissPopups(page, session)
    if (!(await openOwnProfile(page, log, session))) return 'failed'
    const ownUrl = new URL(page.url())
    if (ownUrl.pathname.toLowerCase() !== `/${currentUsername}/`)
      throw new Error('Unexpected browser account')
    await page
      .getByRole('link', { name: 'Edit profile', exact: true })
      .waitFor({ state: 'visible', timeout: session.timeout(15_000) })
    if (task.kind === 'avatar') {
      if (!task.path) return 'failed'
      const buffer = await fs.readFile(task.path)
      const photo = page.getByRole('button', { name: 'Change profile photo', exact: true })
      const before = await photo.locator('img').getAttribute('src')
      await clickAction(photo, session.timeout(5_000))
      const dialog = page.getByRole('dialog').filter({ hasText: 'Change Profile Photo' })
      await dialog
        .getByRole('button', { name: 'Upload Photo', exact: true })
        .waitFor({ state: 'visible', timeout: session.timeout(10_000) })
      const input = page.locator('main input[type="file"][accept*="image/jpeg"]').first()
      session.check()
      submitted = true // Selecting a file immediately starts the upload.
      await input.setInputFiles(
        {
          name: path.basename(task.path),
          mimeType: path.extname(task.path).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg',
          buffer,
        },
        { timeout: session.timeout(30_000) },
      )
      await dialog.waitFor({ state: 'hidden', timeout: session.timeout(30_000) })
      while (session.end - Date.now() > 0) {
        session.check()
        const after = await photo.locator('img').getAttribute('src')
        if (after && after !== before && !/^(blob|data):/.test(after)) {
          // Reload only after the uploaded image has a server URL; a local preview is not confirmation.
          await page.reload({ waitUntil: 'domcontentloaded', timeout: session.timeout(20_000) })
          await photo.waitFor({ state: 'visible', timeout: session.timeout(15_000) })
          const persisted = await photo.locator('img').getAttribute('src')
          if (
            persisted &&
            !/^(blob|data):/.test(persisted) &&
            new URL(persisted, page.url()).pathname !== new URL(before || '', page.url()).pathname
          )
            return 'applied'
          return 'uncertain'
        }
        await session.wait(300)
      }
      return 'uncertain'
    }
    if (!task.value) return 'failed'
    await clickAction(
      page.getByRole('link', { name: 'Edit profile', exact: true }),
      session.timeout(5_000),
    )
    const center = page.locator('a[href^="https://accountscenter.instagram.com/"]').first()
    await center.waitFor({ state: 'visible', timeout: session.timeout(15_000) })
    await clickAction(center, session.timeout(5_000))
    await page.waitForURL((url) => url.hostname === 'accountscenter.instagram.com', {
      timeout: session.timeout(20_000),
    })
    const account = page.getByRole('link', { name: `${currentUsername} Instagram`, exact: true })
    await account.waitFor({ state: 'visible', timeout: session.timeout(20_000) })
    await clickAction(account, session.timeout(5_000))
    const label = task.kind === 'username' ? 'Username' : 'Name'
    const setting = page.getByRole('dialog').getByRole('link', { name: label, exact: true })
    await setting.waitFor({ state: 'visible', timeout: session.timeout(10_000) })
    await clickAction(setting, session.timeout(5_000))
    const form = page.getByRole('dialog', { name: label, exact: true })
    const input = form.getByRole('textbox', { name: label, exact: true })
    await input.waitFor({ state: 'visible', timeout: session.timeout(15_000) })
    if ((await input.inputValue()) !== task.value) {
      await (
        await actionLocator(input, session.timeout(5_000))
      ).fill(task.value, { timeout: session.timeout(5_000) })
      const done = form.getByRole('button', { name: 'Done', exact: true })
      await session.wait(500)
      if (
        task.kind === 'username' &&
        (await form
          .getByText(
            /username.*(?:isn.t available|is not available|already taken)|not available.*username/i,
          )
          .isVisible()
          .catch(() => false))
      ) {
        await returnToInstagram(page, session)
        return 'unavailable'
      }
      session.check()
      submitted = true
      await clickAction(done, session.timeout(10_000))
      try {
        await form.waitFor({ state: 'hidden', timeout: session.timeout(15_000) })
      } catch {
        if (
          task.kind === 'username' &&
          (await form
            .getByText(
              /username.*(?:isn.t available|is not available|already taken)|not available.*username/i,
            )
            .isVisible()
            .catch(() => false))
        ) {
          await returnToInstagram(page, session)
          return 'unavailable'
        }
        throw new Error('Profile save did not confirm')
      }
    } else {
      await clickAction(
        form.getByRole('button', { name: 'Close', exact: true }),
        session.timeout(5_000),
      )
    }
    // Verify the saved profile after returning from Accounts Center, not the draft input.
    await returnToInstagram(page, session)
    await page.reload({ waitUntil: 'domcontentloaded', timeout: session.timeout(20_000) })
    if (!(await openOwnProfile(page, log, session)))
      throw new Error('Profile verification did not open')
    const expectedUsername = task.kind === 'username' ? task.value.toLowerCase() : currentUsername
    if (new URL(page.url()).pathname.toLowerCase() !== `/${expectedUsername}/`)
      throw new Error('Saved username did not match')
    await page
      .getByRole('link', { name: 'Edit profile', exact: true })
      .waitFor({ state: 'visible', timeout: session.timeout(10_000) })
    if (task.kind === 'fullName')
      await page
        .locator('main')
        .getByText(task.value, { exact: true })
        .waitFor({ state: 'visible', timeout: session.timeout(10_000) })
    return 'applied'
  } catch {
    return submitted ? 'uncertain' : 'failed'
  }
}
