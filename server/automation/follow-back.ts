import type { Page } from 'playwright-core';
import { actionLocator } from './actions/action-locator.js';
import { closeNotifications, notificationsHeading, openNotifications } from './actions/instagram-state.js';
import { BrowseSession } from './actions/session.js';
import { smoothScroll } from './actions/scroll.js';
import type { OutreachNotification } from '../shared/outreachNotifications.js';

/** Only links before Instagram's event text identify actors; comment mentions are not actors. */
export function notificationState(el: Element) {
  let panel = el.parentElement;
  while (panel && !['auto', 'scroll'].includes(getComputedStyle(panel).overflowY)) panel = panel.parentElement;
  if (!panel) throw new Error('Notifications scroll container missing');
  const rows = [...panel.querySelectorAll('[data-pressable-container="true"]')].map(row => {
    const body = row.children[1];
    const description = body?.matches('span') ? body : body?.querySelector('span[dir="auto"]');
    const actors: HTMLAnchorElement[] = [];
    let kind: OutreachNotification['kind'] | undefined, tail = '';
    for (const node of description?.childNodes ?? []) {
      if (node.nodeType === 1 && (node as Element).matches('a[href]')) actors.push(node as HTMLAnchorElement);
      if (node.nodeType !== 3) continue;
      const match = node.textContent?.match(/^\s*(?:and\s+(?:\d+\s+)?others\s+)?(started following you\.|liked your (?:post|photo|video|reel)\.|commented:)/i);
      if (!match) continue;
      kind = /^started/i.test(match[1]) ? 'follow' : /^liked/i.test(match[1]) ? 'like' : 'comment';
      tail = node.textContent!.slice(match[0].length);
      break;
    }
    // Likes on comments, story reactions, and mentions do not qualify as post engagement.
    if (kind !== 'follow' && !row.querySelector('a[href^="/p/"], a[href^="/reel/"]')) kind = undefined;
    const events: OutreachNotification[] = kind ? actors.flatMap(a => {
      const href = a.getAttribute('href') ?? '', username = a.textContent?.trim().toLowerCase();
      return /^\/[\w.]+\/$/.test(href) && username === href.split('/')[1]?.toLowerCase()
        ? [{ username, kind: kind! }] : [];
    }) : [];
    const last = description?.lastElementChild;
    const date = description?.querySelector('abbr')?.textContent ?? (last?.matches('span') ? last.textContent : tail) ?? '';
    return { events, date };
  });
  const rect = panel.getBoundingClientRect(), view = el.ownerDocument.defaultView!;
  return { rows, bottom: panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 2,
    height: panel.scrollHeight, loading: !!panel.querySelector('[role="progressbar"]'), panelHeight: panel.clientHeight,
    box: { left: Math.max(0, rect.left), right: Math.min(view.innerWidth, rect.right),
      top: Math.max(0, rect.top), bottom: Math.min(view.innerHeight, rect.bottom) } };
}

/** Read follow-backs and engagement on our posts from the All notifications filter. */
export async function readOutreachNotifications(page: Page, stopped: () => boolean, since = 0,
  session = new BrowseSession(Infinity, stopped)): Promise<OutreachNotification[] | null> {
  if (stopped()) return null;
  if (!await openNotifications(page, session)) return null;
  const heading = notificationsHeading(page);
  try {
    await (await actionLocator(page.getByRole('button', { name: 'All', exact: true }))).click({ timeout: 10_000 });
    const events = new Map<string, OutreachNotification>();
    let stable = 0, previous = '';
    for (let step = 0; step < 60 && !stopped() && !session.stopped(); step++) {
      const state = await heading.evaluate(notificationState);
      for (const row of state.rows) {
        if (notificationTimeUpperBound(row.date) < since) continue;
        for (const event of row.events) events.set(`${event.kind}:${event.username}`, event);
      }
      // Let the filter/load settle before treating cached rows as the end of the scan.
      const old = state.rows.some(row => notificationTimeUpperBound(row.date) < since);
      const signature = `${state.height}:${events.size}:${state.rows.map(row => row.date).join('|')}`;
      stable = !state.loading && signature === previous ? stable + 1 : 0;
      if (stable >= 2 && (state.bottom || old)) return [...events.values()];
      if (events.size > 1000) return null;
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
