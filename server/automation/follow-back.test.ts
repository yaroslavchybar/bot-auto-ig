import { visibleActionGeometry } from './actions/action-locator.test-support.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import type { Page } from 'playwright-core';
import { readFollowNotifications, notificationTimeUpperBound, followsUs, likeRecentPost, ownUsername } from './follow-back.js';
import { followButton, followingButton } from './follow.js';
import { BrowseSession } from './actions/session.js';
import { errors } from 'playwright-core';

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
    const result = await readFollowNotifications(page, () => options.stopped ?? false, options.since, session);
    assert.equal(closed, !options.stopped);
    return { result, scrolls, wheels };
  } finally { globalThis.getComputedStyle = previous; await window.happyDOM.close(); }
}

const row = (name: string, text: string) => `<div data-pressable-container="true"><a href="/${name}/"><img alt="${name}'s profile picture"></a><span><a href="/${name}/">${name}</a> ${text}</span><button>Following</button></div>`;

test('notifications extract only follow events, excluding likes, comments and duplicate avatars', async () => {
  const { result, wheels } = await notifications(row('alice', 'started following you. 1d') + row('bob', 'liked your post. 1h') + row('carol', 'commented: started following someone else.') + row('alice', 'started following you. 2d'));
  assert.deepEqual(result, ['alice']);
  assert.ok(wheels > 1, 'notification scanning uses smooth wheel input');
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

function postLikeFixture(options: { offscreen?: boolean; lateLike?: boolean; confirmationFailure?: boolean } = {}) {
  let liked = false, opened = false, selected = -1, clicks = 0, closed = false;
  const timeouts: number[] = [];
  const tiles = [-1000, options.offscreen ? 1000 : 100].map(top => ({
    ownerDocument: { defaultView: { innerWidth: 1280, innerHeight: 800 } },
    getBoundingClientRect: () => ({ left: 100, top, width: 200, height: 200 }),
  }));
  const handle = (click: () => void, hover = () => {}) => ({ ...visibleActionGeometry,
    hover: async () => hover(), click: async () => click(), dispose: async () => {} });
  const like = { first() { return this; }, isVisible: async () => !liked,
    or: () => ({ waitFor: async (o: { timeout: number }) => { timeouts.push(o.timeout); } }),
    elementHandle: async () => handle(() => { throw new Error('Like must resolve its live locator after hovering'); },
      () => { if (options.lateLike) liked = true; }),
    click: async (o: { timeout: number }) => { assert.equal(liked, false); timeouts.push(o.timeout); clicks++; liked = true; },
  };
  const unlike = { first() { return this; }, isVisible: async () => liked,
    waitFor: async (o: { timeout: number }) => {
      timeouts.push(o.timeout);
      if (options.confirmationFailure) throw new errors.TimeoutError('Like confirmation timed out');
      assert.ok(liked);
    },
  };
  const close = { filter() { return this; }, first() { return this; }, isVisible: async () => opened && !closed,
    elementHandle: async () => handle(() => { closed = true; }) };
  const page = { getByText: () => ({ isVisible: async () => false }),
    locator: () => ({ evaluateAll: async (fn: (tiles: Element[]) => number) => fn(tiles as unknown as Element[]),
      nth: (i: number) => ({ elementHandle: async () => handle(() => { selected = i; opened = true; }) }) }),
    getByRole: (role: string) => role === 'dialog'
      ? { getByRole: () => ({ getByRole: (_role: string, o: { name: string }) => o.name === 'Like' ? like : unlike }) }
      : close,
  } as unknown as Page;
  return { page, stats: () => ({ selected, clicks, closed, timeouts }) };
}

test('optional profile likes open an on-screen tile instead of scrolling to the first grid post', async () => {
  const f = postLikeFixture();
  assert.equal(await likeRecentPost(f.page, async () => true), true);
  assert.equal(f.stats().selected, 1);
  assert.equal(f.stats().clicks, 1);
  assert.equal(f.stats().closed, true);
});

test('optional profile likes skip when no post tile is on screen', async () => {
  const f = postLikeFixture({ offscreen: true });
  assert.equal(await likeRecentPost(f.page, async () => true), false);
  assert.equal(f.stats().selected, -1);
  assert.equal(f.stats().clicks, 0);
});

test('a like registered during hover is not undone by an optional profile like', async () => {
  const f = postLikeFixture({ lateLike: true });
  assert.equal(await likeRecentPost(f.page, async () => true), false);
  assert.equal(f.stats().clicks, 0);
  assert.equal(f.stats().closed, true);
});

test('optional like waits respect the remaining session time and close the dialog after failure', async () => {
  const f = postLikeFixture({ confirmationFailure: true });
  await assert.rejects(likeRecentPost(f.page, async () => true, async () => true,
    new BrowseSession(Date.now() + 1000)), errors.TimeoutError);
  assert.ok(f.stats().timeouts.every(timeout => timeout > 0 && timeout <= 1000));
  assert.equal(f.stats().closed, true);
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
      const target = { ...methods, elementHandle: async () => ({ ...visibleActionGeometry, hover: async () => {}, ...methods, dispose: async () => {} }) };
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
