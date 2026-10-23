import { errors, type Page } from 'playwright-core';
import { actionLocator, clickAction } from './actions/action-locator.js';
import { withUiDiagnosticContext } from './actions/ui-diagnostics.js';

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

/** Wait for either relationship controls or Instagram's unavailable-profile notice. */
export async function profileAvailable(page: Page, timeout = 15_000): Promise<boolean> {
  const controls = followingButton(page).or(followButton(page)).filter({ visible: true }).first();
  const unavailable = page.getByText(/^(?:Sorry, this page isn['’]t available|This page isn['’]t available|Page not found)\.?$/i)
    .filter({ visible: true }).first();
  await controls.or(unavailable).first().waitFor({ state: 'visible', timeout });
  if (await controls.isVisible()) return true;
  if (await unavailable.isVisible()) return false;
  throw new errors.TimeoutError('Profile content changed while loading');
}

/** Wait for loaded profile content before deciding whether a follow request is needed. */
export async function outreachProfileState(page: Page, username: string, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  const remaining = () => Math.max(1, deadline - Date.now());
  const main = page.locator('main');
  await profileControls(page).waitFor({ state: 'visible', timeout: remaining() });
  await followingButton(page).or(followButton(page)).waitFor({ state: 'visible', timeout: remaining() });
  const privateNotice = main.getByText(/^(This profile is private|This account is private)$/);
  const posts = main.locator(`a[href^="/${username}/p/"], a[href^="/${username}/reel/"]`);
  await privateNotice.or(main.getByText('No posts yet', { exact: true })).or(posts.first())
    .first().waitFor({ state: 'visible', timeout: remaining() });
  if (new URL(page.url()).pathname.toLowerCase() !== `/${username.toLowerCase()}/`)
    throw new errors.TimeoutError('Outreach profile navigation changed');
  const isPrivate = await privateNotice.isVisible();
  const pending = await followingButton(page).isVisible() &&
    /^requested\b/i.test(await followingButton(page).innerText({ timeout: remaining() }));
  return { isPrivate, canMessage: !isPrivate && !pending };
}

const blockedMessageText = "This account can't receive your message because they don't allow new message requests from everyone.";

export async function messageWasBlocked(page: Page) {
  return withUiDiagnosticContext({ expectedTimeout: true }, () => page.getByText(blockedMessageText, { exact: true })
    .waitFor({ state: 'visible', timeout: 5_000 })).then(() => true, () => false);
}

/** Wait for relationship controls and recognize both follows and pending requests. */
export async function isFollowing(page: Page) {
  await followingButton(page).or(followButton(page)).waitFor({ state: 'visible', timeout: 15_000 });
  return followingButton(page).isVisible();
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
