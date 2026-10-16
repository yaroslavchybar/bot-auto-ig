import { errors, type Page } from 'playwright-core';
import { actionLocator, clickAction } from './actions/action-locator.js';

export const profileControls = (page: Page) => page.locator('main header');
// Suggested accounts can appear inside the header; exclude their list controls.
const profileButtons = '//main//header//*[not(ancestor::ul or ancestor::*[@role="list"])]';
// Cloak's humanized actions require a single CSS/text/XPath engine, not chained role locators.
function button(page: Page, scope: string, labels: readonly string[]) {
  const text = 'translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")';
  // SVG titles join the label without spaces (e.g. FollowingDown chevron icon).
  return page.locator(`xpath=${scope}[self::button or @role="button"][.//text()[not(ancestor::*[local-name()="svg"])][${labels.map(label => `${text}="${label}"`).join(' or ')}]]`);
}
export const followButton = (page: Page) => button(page, profileButtons, ['follow', 'follow back']);
export const followingButton = (page: Page) => button(page, profileButtons, ['following', 'requested', 'following down chevron icon', 'requested down chevron icon']);
export const messageButton = (page: Page) => button(page, profileButtons, ['message']);

// Instagram currently opens the composer as an overlay on the profile URL.
// Older layouts exposed a named textbox, while the current layout exposes an
// unnamed contenteditable textbox next to the visible “Message...” label.
export async function messageComposer(page: Page) {
  const named = page.locator('[role="textbox"][aria-label*="message" i], textarea[placeholder*="message" i]');
  // The current chat overlay has no dialog role; limit unnamed editors to its root.
  const fallback = page.locator('[data-pagelet="IGDChatTabsRootContentOffMsys"] [role="textbox"][contenteditable="true"]');
  await named.or(fallback).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 15_000 });
  for (const fields of [named, fallback]) {
    for (let i = 0; i < await fields.count(); i++) {
      const field = fields.nth(i);
      if (await field.isVisible()) return field;
    }
  }
  throw new Error('Instagram message composer is missing');
}

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
  await (await actionLocator(sentMessage)).hover({ timeout: 10_000 });

  const actions = page
    .getByRole('button', { name: /See more options for message from/i })
    .last();
  await actions.waitFor({ state: 'visible', timeout: 10_000 });
  await (await actionLocator(actions)).click({ timeout: 10_000 });

  const unsend = page.getByRole('button', { name: /^Unsend(?: Unsend)?$/i }).last();
  await unsend.waitFor({ state: 'visible', timeout: 10_000 });
  await (await actionLocator(unsend)).click({ timeout: 10_000 });

  // Some layouts show a confirmation dialog; others remove the message
  // immediately after the menu action.
  const confirmation = page
    .getByRole('dialog')
    .getByRole('button', { name: /^Unsend(?: Unsend)?$/i })
    .last();
  if (await confirmation.isVisible().catch(() => false))
    await (await actionLocator(confirmation)).click({ timeout: 10_000 });

  await sentMessage.waitFor({ state: 'detached', timeout: 15_000 });
}

/** Wait for relationship controls and recognize both follows and pending requests. */
export async function isFollowing(page: Page) {
  await followingButton(page).or(followButton(page)).waitFor({ state: 'visible', timeout: 15_000 });
  return followingButton(page).isVisible();
}

/** Requested is not approval, even when Instagram already exposes a Message button. */
export async function canMessageFollowedProfile(page: Page, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  const remaining = () => Math.max(1, deadline - Date.now());
  const following = followingButton(page);
  await following.or(followButton(page)).waitFor({ state: 'visible', timeout: remaining() });
  if (!await following.isVisible() || !/^following\b/i.test(await following.innerText({ timeout: remaining() })))
    return false;
  try {
    await messageButton(page).waitFor({ state: 'visible', timeout: remaining() });
    return true;
  } catch (error) {
    if (error instanceof errors.TimeoutError) return false;
    throw error;
  }
}

export async function unfollow(page: Page, allowed: () => Promise<boolean>) {
  if (!await isFollowing(page)) return true;
  if (!await allowed()) return false;
  await clickAction(followingButton(page));
  const labels = ['unfollow', 'cancel request'];
  const dialogConfirm = button(page, '//*[@role="dialog"]//*', labels).filter({ visible: true }).first();
  const fallback = button(page, '//*', labels).filter({ visible: true }).last();
  // Some private-profile layouts cancel a request immediately after clicking Requested.
  await dialogConfirm.or(fallback).or(followButton(page)).first().waitFor({ state: 'visible', timeout: 10_000 });
  if (await followButton(page).isVisible()) return true;
  if (!await allowed()) return false;
  // Hidden or unrelated dialogs must not suppress the page-level confirmation.
  const confirm = await dialogConfirm.isVisible() ? dialogConfirm : fallback;
  await (await actionLocator(confirm)).click({ timeout: 10_000 });
  await followButton(page).waitFor({ state: 'visible', timeout: 15_000 });
  return true;
}
