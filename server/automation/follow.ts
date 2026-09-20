import type { Page } from 'playwright-core';

// Scope controls to the recipient header; suggested accounts also have Follow buttons.
export const profileControls = (page: Page) => page.locator('main header');
export const followButton = (page: Page) => profileControls(page).getByRole('button', { name: /^(Follow|Follow back)$/i });
export const followingButton = (page: Page) => profileControls(page).getByRole('button', { name: /^(Following|Requested)$/i });

export async function hasMessageButton(page: Page) {
  return profileControls(page).getByRole('button', { name: 'Message', exact: true })
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
