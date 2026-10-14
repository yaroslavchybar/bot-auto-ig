import type { Page } from 'playwright-core';
import { profileControls } from './follow.js';
import { actionLocator } from './actions/action-locator.js';
import { closeNotifications, notificationsHeading, openNotifications } from './actions/instagram-state.js';
import { BrowseSession } from './actions/session.js';
import { smoothScroll } from './actions/scroll.js';

/** Read only follow events; likes/comments and suggested accounts are not followers. */
export async function readFollowNotifications(page: Page, stopped: () => boolean, since = 0,
  session = new BrowseSession(Infinity, stopped)): Promise<string[] | null> {
  if (stopped()) return null;
  if (!await openNotifications(page, session)) return null;
  const heading = notificationsHeading(page);
  try {
    await (await actionLocator(page.getByRole('button', { name: 'Follows', exact: true }))).click({ timeout: 10_000 });
    const names = new Set<string>();
    let stable = 0, previous = '';
    for (let step = 0; step < 60 && !stopped() && !session.stopped(); step++) {
      const state = await heading.evaluate(el => {
        let panel = el.parentElement;
        while (panel && !['auto', 'scroll'].includes(getComputedStyle(panel).overflowY)) panel = panel.parentElement;
        if (!panel) throw new Error('Notifications scroll container missing');
        const rows = [...panel.querySelectorAll('[data-pressable-container="true"]')]
          .filter(row => /started following you\./i.test(row.textContent ?? ''));
        const usernames = rows.flatMap(row => [...row.querySelectorAll<HTMLAnchorElement>('a[href]')]
            .filter(a => /^\/[\w.]+\/$/.test(a.getAttribute('href') ?? '') &&
              a.textContent?.trim().toLowerCase() === a.getAttribute('href')?.split('/')[1]?.toLowerCase())
            .map(a => a.textContent!.trim().toLowerCase()));
        return { usernames, dates: rows.map(row => row.textContent?.split(/started following you\./i)[1] ?? ''),
          bottom: panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 2,
          height: panel.scrollHeight, loading: !!panel.querySelector('[role="progressbar"]'),
          panelHeight: panel.clientHeight, box: (() => {
            const rect = panel.getBoundingClientRect();
            const view = el.ownerDocument.defaultView!;
            return { left: Math.max(0, rect.left), right: Math.min(view.innerWidth, rect.right),
              top: Math.max(0, rect.top), bottom: Math.min(view.innerHeight, rect.bottom) };
          })() };
      });
      for (const name of state.usernames) names.add(name);
      // Let the filter/load settle before treating cached rows as the end of the scan.
      const old = state.dates.some(date => notificationTimeUpperBound(date) < since);
      const signature = `${state.height}:${names.size}:${state.dates.join('|')}`;
      stable = !state.loading && signature === previous ? stable + 1 : 0;
      if (stable >= 2 && (state.bottom || old)) return [...names];
      if (names.size > 1000) return null;
      previous = signature;
      if (!old && state.box.right > state.box.left && state.box.bottom > state.box.top) {
        session.check();
        await page.mouse.move((state.box.left + state.box.right) / 2, (state.box.top + state.box.bottom) / 2);
        await smoothScroll(page, state.panelHeight * 0.8, session);
      }
      await page.waitForTimeout(1000);
    }
    return null; // An interrupted scan must not suppress the next attempt today.
  } finally {
    await closeNotifications(page, session);
  }
}

/** Use the latest possible event time for coarse Instagram dates, so boundary rows aren't lost. */
export function notificationTimeUpperBound(text: string, now = Date.now()): number {
  const relative = text.match(/^\s*(\d+)\s*([smhdw])(?=\s|Follow|$)/i);
  if (relative) {
    const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[relative[2].toLowerCase()]!;
    return now - Math.max(0, Number(relative[1]) - 1) * unit;
  }
  const absolute = text.match(/^\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:,\s*(\d{4}))?/i);
  if (!absolute) return Infinity; // Unknown or localized formats must not truncate the scan.
  const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(absolute[1].toLowerCase());
  let year = absolute[3] ? Number(absolute[3]) : new Date(now).getUTCFullYear();
  if (!absolute[3] && Date.UTC(year, month, Number(absolute[2])) > now) year--;
  return Date.UTC(year, month, Number(absolute[2]) + 1) + 86_400_000; // Include timezone/date rounding.
}

export async function ownUsername(page: Page) {
  // The navigation avatar is outside main; recipient avatars live inside main.
  const navigationPath = await page.locator('a').filter({ has: page.locator('img[alt$="\'s profile picture"]') })
    .evaluateAll(links => links.find(a => !a.closest('main') && /^\/[\w.]+\/$/.test(a.getAttribute('href') ?? ''))?.getAttribute('href'));
  const username = navigationPath?.split('/')[1];
  if (!username) throw new Error('Could not identify the signed-in Instagram account');
  return username;
}

/** Notifications can be old: verify the current relationship before composing a DM. */
export async function followsUs(page: Page, username: string) {
  if (await page.getByText(/This (?:account|profile) is private/i, { exact: true }).isVisible()) return false;
  await (await actionLocator(profileControls(page).getByRole('link', { name: /^[\d,.\sKMB]+ following$/i }))).click({ timeout: 10_000 });
  const dialog = page.getByRole('dialog');
  try {
    const search = dialog.getByRole('textbox', { name: 'Search input', exact: true });
    await search.waitFor({ state: 'visible', timeout: 15_000 });
    // Instagram puts our account first when present. Otherwise use its server-side search.
    const own = dialog.getByRole('link', { name: username, exact: true });
    if (await own.isVisible()) return true;
    await (await actionLocator(search)).fill(username);
    return await own.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false);
  } finally {
    await (await actionLocator(dialog.getByRole('button', { name: 'Close', exact: true }), 5000)).click({ timeout: 5000 });
  }
}
