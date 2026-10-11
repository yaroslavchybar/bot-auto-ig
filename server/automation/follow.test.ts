import assert from 'node:assert/strict';
import test from 'node:test';
import type { Page } from 'playwright-core';

import { unsendMessage } from './follow.js';

test('unsendMessage waits for the selected duplicate message to detach', async () => {
  let matchingMessageCount = 2;
  let detachedIndex: number | undefined;
  let unsendClicked = false;

  const fixedMessage = {
    hover: async () => {},
    waitFor: async ({ state }: { state: string }) => {
      if (state === 'detached') {
        assert.equal(unsendClicked, true);
        detachedIndex = 1;
      }
    },
  };
  const matchingMessages = {
    count: async () => matchingMessageCount,
    last: () => ({
      waitFor: async ({ state }: { state: string }) => {
        if (state === 'detached' && matchingMessageCount === 1)
          throw new Error('the earlier duplicate message is still attached');
      },
    }),
    nth: (index: number) => {
      assert.equal(index, 1);
      return fixedMessage;
    },
  };

  const page = {
    getByRole: (role: string, options?: { name?: unknown }) => {
      if (role === 'article') return matchingMessages;

      if (role === 'button' && String(options?.name).includes('See more options'))
        return { last: () => ({ waitFor: async () => {}, click: async () => {} }) };

      if (role === 'button' && String(options?.name).includes('Unsend'))
        return {
          last: () => ({
            waitFor: async () => {},
            click: async () => {
              matchingMessageCount = 1;
              unsendClicked = true;
            },
          }),
        };

      if (role === 'dialog')
        return { getByRole: () => ({ last: () => ({ isVisible: async () => false }) }) };

      throw new Error(`Unexpected role: ${role}`);
    },
  } as unknown as Page;

  await unsendMessage(page, 'Hello');

  assert.equal(unsendClicked, true);
  assert.equal(detachedIndex, 1);
});

test('private request cleanup handles both immediate cancellation and confirmation dialogs', async () => {
  const { unfollow } = await import('./follow.js');
  for (const immediate of [false, true]) {
    let following = true, confirmation = false, confirmed = false;
    const follow = { isVisible: async () => !following, waitFor: async () => { assert.equal(following, false); } };
    const relationship = {
      isVisible: async () => following,
      or: () => ({ waitFor: async () => {} }),
      click: async () => { if (immediate) following = false; else confirmation = true; },
    };
    const confirm = {
      or: () => ({ waitFor: async () => { assert.ok(confirmation || !following); } }),
      click: async () => { confirmed = true; following = false; },
    };
    const page = {
      locator: () => ({ getByRole: (_: string, options: { name: RegExp }) => options.name.test('Requested') ? relationship : follow }),
      getByRole: () => confirm,
    } as unknown as Page;
    assert.equal(await unfollow(page, async () => true), true);
    assert.equal(following, false);
    assert.equal(confirmed, !immediate);
  }
});
