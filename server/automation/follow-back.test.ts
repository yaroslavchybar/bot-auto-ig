import { visibleActionGeometry } from './actions/action-locator.test-support.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import type { Page } from 'playwright-core';
import { readOutreachNotifications, notificationTimeUpperBound, ownUsername } from './follow-back.js';
import { followButton, followingButton, messageButton } from './follow.js';
import { BrowseSession } from './actions/session.js';

async function notifications(html: string, options: { stopped?: boolean; since?: number; loading?: boolean } = {}) {
  const window = new Window();
  window.document.body.innerHTML = `<div style="overflow-y:auto"><h1>Notifications</h1>${html}${options.loading ? '<div role="progressbar"></div>' : ''}</div>`;
  const heading = window.document.querySelector('h1')!;
  const panel = heading.parentElement!;
  Object.defineProperties(panel, { clientHeight: { value: 500 }, scrollHeight: { value: 800 } });
  panel.getBoundingClientRect = () => ({ left: 0, right: 400, top: 0, bottom: 500 }) as DOMRect;
  const previous = globalThis.getComputedStyle;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window) as unknown as typeof getComputedStyle;
  let closed = false, scrolls = 0, wheels = 0;
  const close = { filter() { return this; }, first() { return this; }, isVisible: async () => !closed,
    elementHandle: async () => ({ ...visibleActionGeometry, hover: async () => {}, click: async () => { closed = true; }, dispose: async () => {} }) };
  const title = { filter() { return this; }, first() { return this; }, isVisible: async () => !closed,
    waitFor: async () => {}, evaluate: async (fn: (el: HTMLElement) => unknown) => fn(heading as unknown as HTMLElement),
    locator: (selector: string) => { assert.match(selector, /^xpath=ancestor::/); return { getByRole: () => close }; } };
  const controls = new Map<string, unknown>();
  const page = {
    url: () => 'https://www.instagram.com/',
    getByRole: (role: string, opts: { name: string }) => role === 'heading'
      ? title
      : {
        elementHandle: async () => ({
          ...visibleActionGeometry, hover: async () => {},
          click: async () => { if (opts.name === 'Close') closed = true; },
          dispose: async () => {},
        }),
        page: () => page,
        evaluate: async () => {
          const xpath = `/*[1]/*[${opts.name === 'Close' ? 3 : opts.name === 'Follows' ? 2 : 1}]`;
          controls.set(`xpath=${xpath}`, { click: async () => { if (opts.name === 'Close') closed = true; } });
          return xpath;
        },
      },
    locator: (selector: string) => {
      assert.ok(controls.has(selector), `Unsupported action selector: ${selector}`);
      return controls.get(selector);
    },
    waitForTimeout: async () => { scrolls++; },
    mouse: { move: async (x: number, y: number) => { assert.equal(x, 200); assert.equal(y, 250); },
      wheel: async (_x: number, y: number) => { wheels++; panel.scrollTop = Math.min(300, panel.scrollTop + y); } },
  } as unknown as Page;
  try {
    const session = new BrowseSession(Infinity, () => options.stopped ?? false);
    session.wait = async () => { session.check(); };
    const result = await readOutreachNotifications(page, () => options.stopped ?? false, options.since, session);
    assert.equal(closed, !options.stopped);
    return { result, scrolls, wheels };
  } finally { globalThis.getComputedStyle = previous; await window.happyDOM.close(); }
}

const row = (name: string, text: string) => `<div data-pressable-container="true"><a href="/${name}/"><img alt="${name}'s profile picture"></a><span><a href="/${name}/">${name}</a> ${text}</span><button>Following</button><a href="/p/own-post/">Media thumbnail</a></div>`;

test('notifications identify follow, like and comment actors without duplicate avatars', async () => {
  const { result, wheels } = await notifications(row('alice', 'started following you. 1d') + row('bob', 'liked your post. 1h') + row('carol', 'commented: started following someone else.') + row('alice', 'started following you. 2d'));
  assert.deepEqual(result, [{ username: 'alice', kind: 'follow' }, { username: 'bob', kind: 'like' }, { username: 'carol', kind: 'comment' }]);
  assert.ok(wheels > 1, 'notification scanning uses smooth wheel input');
});

test('grouped likes include only named actors and comments exclude mentioned usernames', async () => {
  const grouped = `<div data-pressable-container="true"><button>Avatars</button><div><span dir="auto"><a href="/alice/">alice</a>, <a href="/bob/">bob</a> and 7 others liked your photo. <span>Oct 05</span></span></div><a href="/p/own/">Media thumbnail</a></div>`;
  const comment = row('carol', 'commented: Hi <a href="/someone_else/">someone_else</a> started following you. <span>Oct 04</span>');
  const { result } = await notifications(grouped + comment);
  assert.deepEqual(result, [
    { username: 'alice', kind: 'like' }, { username: 'bob', kind: 'like' }, { username: 'carol', kind: 'comment' },
  ]);
});

test('comment likes, story reactions, mentions and suggestions never qualify as post engagement', async () => {
  const html = ['liked your comment.', 'liked your story.', 'mentioned you in a comment: started following you.',
    'is on Instagram. Follow them to see their posts.'].map(text => row('alice', text)).join('') +
    row('bob', 'commented: Hello').replace('<a href="/p/own-post/">Media thumbnail</a>', '');
  assert.deepEqual((await notifications(html)).result, []);
});

test('stale engagement rows are ignored using the timestamp outside comment text', async () => {
  const html = row('alice', 'commented: 1s old content <span>Jan 01</span>') +
    row('bob', 'liked your photo. <span>Jan 02</span>');
  assert.deepEqual((await notifications(html, { since: Date.UTC(new Date().getUTCFullYear(), 0, 5) })).result, []);
});

test('a fully loaded empty notification panel completes as an empty list', async () => {
  assert.deepEqual((await notifications('')).result, []);
});

test('an interrupted or still-loading notification panel never marks the scan complete', async () => {
  assert.equal((await notifications('', { stopped: true })).result, null);
  assert.equal((await notifications('', { loading: true })).result, null);
});

test('notification scanning stops at old history instead of scrolling the full account lifetime', async () => {
  const result = await notifications(row('alice', 'started following you. Jan 01'), { since: Date.UTC(new Date().getUTCFullYear(), 0, 5) });
  assert.equal(result.scrolls, 2);
});

test('coarse notification dates keep boundary events and handle the year rollover', () => {
  const now = Date.UTC(2026, 0, 2, 12);
  assert.equal(notificationTimeUpperBound(' 1dFollowing', now), now);
  assert.equal(notificationTimeUpperBound(' 3hFollow Back', now), now - 2 * 3_600_000);
  assert.ok(notificationTimeUpperBound(' Dec 30Following', now) < now);
  assert.equal(notificationTimeUpperBound(' just nowFollowing', now), Infinity);
  assert.equal(notificationTimeUpperBound(' неизвестноFollowing', now), Infinity);
});

test('relationship selectors support humanized clicks without role or chained engines', () => {
  const selectors: string[] = [];
  const page = { locator: (selector: string) => { selectors.push(selector); } } as unknown as Page;
  followButton(page); followingButton(page); messageButton(page);
  for (const selector of selectors) {
    assert.ok(selector.startsWith('xpath=//main//header/'));
    assert.ok(!selector.includes('>>'));
    assert.ok(!selector.includes('internal:role'));
    assert.ok(selector.includes('not(ancestor::ul or ancestor::*[@role="list"])'));
  }
  assert.ok(selectors[0].includes('="follow"')); assert.ok(selectors[0].includes('="follow back"'));
  assert.ok(selectors[1].includes('="requested"')); assert.ok(selectors[1].includes('="following down chevron icon"'));
  assert.ok(!selectors[0].includes('="unfollow"'));
});

test('own username comes from the navigation avatar, not the recipient avatar', async () => {
  const window = new Window();
  window.document.body.innerHTML = `<nav><a href="/sender/"><img alt="sender's profile picture"></a></nav><main><a href="/alice/"><img alt="alice's profile picture"></a></main>`;
  const links = [...window.document.querySelectorAll('a')];
  const page = { locator: () => ({ filter: () => ({ evaluateAll: async (fn: (links: unknown[]) => unknown) => fn(links) }) }) } as unknown as Page;
  try { assert.equal(await ownUsername(page), 'sender'); } finally { await window.happyDOM.close(); }
});
