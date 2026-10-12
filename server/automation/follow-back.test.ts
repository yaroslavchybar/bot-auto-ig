import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import type { Page } from 'playwright-core';
import { readFollowNotifications, notificationTimeUpperBound, followsUs, likeRecentPost, ownUsername } from './follow-back.js';
import { followButton, followingButton } from './follow.js';

async function notifications(html: string, options: { stopped?: boolean; since?: number; loading?: boolean } = {}) {
  const window = new Window();
  window.document.body.innerHTML = `<div style="overflow-y:auto"><h1>Notifications</h1>${html}${options.loading ? '<div role="progressbar"></div>' : ''}</div>`;
  const heading = window.document.querySelector('h1')!;
  const panel = heading.parentElement!;
  Object.defineProperties(panel, { clientHeight: { value: 500 }, scrollHeight: { value: 800 } });
  const previous = globalThis.getComputedStyle;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window) as unknown as typeof getComputedStyle;
  let closed = false, scrolls = 0;
  const controls = new Map<string, unknown>();
  const page = {
    getByRole: (role: string, opts: { name: string }) => role === 'heading'
      ? { waitFor: async () => {}, evaluate: async (fn: (el: HTMLElement) => unknown) => fn(heading as unknown as HTMLElement) }
      : {
        elementHandle: async () => ({
          hover: async () => {},
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
  } as unknown as Page;
  try {
    const result = await readFollowNotifications(page, () => options.stopped ?? false, options.since);
    assert.equal(closed, true);
    return { result, scrolls };
  } finally { globalThis.getComputedStyle = previous; await window.happyDOM.close(); }
}

const row = (name: string, text: string) => `<div data-pressable-container="true"><a href="/${name}/"><img alt="${name}'s profile picture"></a><span><a href="/${name}/">${name}</a> ${text}</span><button>Following</button></div>`;

test('notifications extract only follow events, excluding likes, comments and duplicate avatars', async () => {
  const { result } = await notifications(row('alice', 'started following you. 1d') + row('bob', 'liked your post. 1h') + row('carol', 'commented: started following someone else.') + row('alice', 'started following you. 2d'));
  assert.deepEqual(result, ['alice']);
});

test('a fully loaded empty notification panel completes as an empty list', async () => {
  assert.deepEqual((await notifications('')).result, []);
});

test('an interrupted or still-loading notification panel never marks the scan complete', async () => {
  assert.equal((await notifications('', { stopped: true })).result, null);
  assert.equal((await notifications('', { loading: true })).result, null);
});

test('notification scanning stops at old history instead of scrolling the full account lifetime', async () => {
  const result = await notifications(row('alice', 'started following you. Jan 01'), { since: Date.UTC(2026, 9, 10) });
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

for (const wording of ['This profile is private', 'This account is private']) test(`${wording} skips post likes and inaccessible following lists`, async () => {
  const page = { getByText: (text: RegExp) => ({ isVisible: async () => text.test(wording) }) } as unknown as Page;
  assert.equal(await followsUs(page, 'sender'), false);
  assert.equal(await likeRecentPost(page, async () => true), false);
});

test('relationship selectors support humanized clicks without role or chained engines', () => {
  const selectors: string[] = [];
  const page = { locator: (selector: string) => { selectors.push(selector); } } as unknown as Page;
  followButton(page); followingButton(page);
  for (const selector of selectors) {
    assert.ok(selector.startsWith('xpath=//main//header/'));
    assert.ok(!selector.includes('>>'));
    assert.ok(!selector.includes('internal:role'));
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

test('live follow-back verification requires an exact username in the current following dialog', async () => {
  for (const present of [false, true]) {
    let closed = false, searched = '';
    const controls = new Map<string, unknown>();
    const actionable = <T extends object>(index: number, methods: T) => {
      const xpath = `/*[1]/*[${index}]`;
      const target = { ...methods, elementHandle: async () => ({ hover: async () => {}, ...methods, dispose: async () => {} }) };
      controls.set(`xpath=${xpath}`, target);
      return target;
    };
    const own = { isVisible: async () => false, waitFor: async () => { if (!present) throw new Error('missing'); } };
    const search = actionable(1, { waitFor: async () => {}, fill: async (value: string) => { searched = value; } });
    const dialog = { getByRole: (role: string, options: { name: string }) => {
      if (role === 'textbox') return search;
      if (role === 'link') { assert.equal(options.name, 'sender'); return own; }
      return actionable(2, { click: async () => { closed = true; } });
    } };
    const page = {
      getByText: () => ({ isVisible: async () => false }),
      locator: (selector: string) => selector === 'main header'
        ? { getByRole: () => actionable(3, { click: async () => {} }) }
        : controls.get(selector),
      getByRole: () => dialog,
    } as unknown as Page;
    assert.equal(await followsUs(page, 'sender'), present);
    assert.equal(searched, 'sender'); assert.equal(closed, true);
  }
});
