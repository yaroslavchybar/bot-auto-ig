import type { Page } from 'playwright-core';

// Scope controls to the recipient header; suggested accounts also have Follow buttons.
export const profileControls = (page: Page) => page.locator('main header');
export const followButton = (page: Page) => profileControls(page).getByRole('button', { name: /^(Follow|Follow back)$/i });
export const followingButton = (page: Page) => profileControls(page).getByRole('button', { name: /^(Following|Requested)$/i });
export const messageButton = (page: Page) => profileControls(page).getByRole('button', { name: 'Message', exact: true });

// Instagram currently opens the composer as an overlay on the profile URL.
// Older layouts exposed a named textbox, while the current layout exposes an
// unnamed contenteditable textbox next to the visible “Message...” label.
export const messageComposer = (page: Page) =>
  page
    .getByRole('textbox', { name: /message/i })
    .or(page.locator('[contenteditable="true"], textarea[placeholder*="message" i]').first())
    .first();

const blockedMessageText = "This account can't receive your message because they don't allow new message requests from everyone.";

export async function messageWasBlocked(page: Page) {
  return page.getByText(blockedMessageText, { exact: true })
    .waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false);
}

/** Remove the just-sent message from the current Instagram DM thread. */
export async function unsendMessage(page: Page, message: string) {
  const matchingMessages = page.getByRole('article', { name: message, exact: true });
  await matchingMessages.last().waitFor({ state: 'visible', timeout: 15_000 });
  const sentMessage = matchingMessages.nth((await matchingMessages.count()) - 1);
  await sentMessage.hover({ timeout: 10_000 });

  const actions = page
    .getByRole('button', { name: /See more options for message from/i })
    .last();
  await actions.waitFor({ state: 'visible', timeout: 10_000 });
  await actions.click({ timeout: 10_000 });

  const unsend = page.getByRole('button', { name: /^Unsend(?: Unsend)?$/i }).last();
  await unsend.waitFor({ state: 'visible', timeout: 10_000 });
  await unsend.click({ timeout: 10_000 });

  // Some layouts show a confirmation dialog; others remove the message
  // immediately after the menu action.
  const confirmation = page
    .getByRole('dialog')
    .getByRole('button', { name: /^Unsend(?: Unsend)?$/i })
    .last();
  if (await confirmation.isVisible().catch(() => false))
    await confirmation.click({ timeout: 10_000 });

  await sentMessage.waitFor({ state: 'detached', timeout: 15_000 });
}

export async function hasMessageButton(page: Page) {
  return messageButton(page)
    .waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false);
}

/** Read the relationship after a crash without repeating the Follow click. */
export async function isFollowing(page: Page) {
  await followingButton(page).or(followButton(page)).waitFor({ state: 'visible', timeout: 15_000 });
  return followingButton(page).isVisible();
}

export async function unfollow(page: Page, allowed: () => Promise<boolean>) {
  if (!await isFollowing(page)) return true;
  if (!await allowed()) return false;
  await followingButton(page).click({ timeout: 10_000 });
  const confirm = page.getByRole('button', { name: /^(Unfollow|Cancel request)$/i, exact: true });
  await confirm.waitFor({ state: 'visible', timeout: 10_000 });
  if (!await allowed()) return false;
  await confirm.click({ timeout: 10_000 });
  await followButton(page).waitFor({ state: 'visible', timeout: 15_000 });
  return true;
}
