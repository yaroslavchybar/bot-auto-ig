import { visibleActionGeometry } from './actions/action-locator.test-support.js'
import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { errors, type Page } from 'playwright-core';

import { messageComposer, unsendMessage } from './follow.js';

test('unsendMessage waits for the selected duplicate message to detach', async () => {
  let matchingMessageCount = 2;
  let detachedIndex: number | undefined;
  let unsendClicked = false;
  const actionTargets = new Map<string, unknown>();
  const actionable = <T extends object>(index: number, methods: T) => {
    const xpath = `/*[1]/*[${index}]`;
    const target = { ...methods, elementHandle: async () => ({ ...visibleActionGeometry, hover: async () => {}, ...methods, dispose: async () => {} }) };
    actionTargets.set(`xpath=${xpath}`, target);
    return target;
  };

  const fixedMessage = actionable(1, {
    ...visibleActionGeometry, hover: async () => {},
    waitFor: async ({ state }: { state: string }) => {
      if (state === 'detached') {
        assert.equal(unsendClicked, true);
        detachedIndex = 1;
      }
    },
  });
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
    locator: (selector: string) => {
      assert.ok(actionTargets.has(selector), `Unknown action target: ${selector}`);
      return actionTargets.get(selector);
    },
    getByRole: (role: string, options?: { name?: unknown }) => {
      if (role === 'article') return matchingMessages;

      if (role === 'button' && String(options?.name).includes('See more options'))
        return { last: () => actionable(2, { waitFor: async () => {}, click: async () => {} }) };

      if (role === 'button' && String(options?.name).includes('Unsend'))
        return {
          last: () => actionable(3, {
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

test('private request cleanup prefers visible dialog confirmations without blocking the fallback', async () => {
  const { unfollow } = await import('./follow.js');
  for (const layout of ['immediate', 'dialog', 'no-dialog', 'unrelated-dialog', 'hidden-dialog', 'hidden-dialog-button']) {
    const window = new Window();
    try {
      const document = window.document;
      document.body.innerHTML = '<header><button id="relationship">Following</button><button id="follow" hidden>Follow</button></header><button id="unrelated">Unfollow</button>';
      const visible = (element: Element) => !element.closest('[hidden]');
      let clicked = '';
      const complete = () => {
        document.querySelector('#relationship')!.setAttribute('hidden', '');
        document.querySelector('#follow')!.removeAttribute('hidden');
      };
      const openConfirmation = () => {
        if (layout === 'immediate') return complete();
        const dialog = layout === 'dialog' ? '<div role="dialog"><button id="dialog-confirm">Unfollow</button></div>'
          : layout === 'unrelated-dialog' ? '<div role="dialog"><button>Close</button></div>'
          : layout === 'hidden-dialog' ? '<div role="dialog" hidden><button id="hidden-confirm">Unfollow</button></div>'
          : layout === 'hidden-dialog-button' ? '<div role="dialog"><button id="hidden-confirm" hidden>Unfollow</button></div>' : '';
        // A later page button must lose to a visible dialog confirmation.
        document.body.insertAdjacentHTML('beforeend', dialog + '<button id="page-confirm">Cancel request</button>');
      };
      class Fields {
        constructor(readonly find: () => Element[]) {}
        filter() { return new Fields(() => this.find().filter(visible)); }
        first() { return new Fields(() => this.find().slice(0, 1)); }
        last() { return new Fields(() => this.find().slice(-1)); }
        or(other: Fields) { return new Fields(() => [...new Set([...this.find(), ...other.find()])]); }
        async isVisible() { return this.find().some(visible); }
        async waitFor() { assert.ok(await this.isVisible(), `no visible match for ${layout}`); }
        async click() {
          const elements = this.find();
          assert.equal(elements.length, 1);
          const element = elements[0]!;
          assert.ok(visible(element));
          if (element.id === 'relationship') return openConfirmation();
          clicked = element.id;
          assert.equal(clicked, layout === 'dialog' ? 'dialog-confirm' : 'page-confirm');
          complete();
        }
        async elementHandle() { return { ...visibleActionGeometry, hover: async () => {}, click: () => this.click(), dispose: async () => {} }; }
      }
      const page = { locator: (selector: string) => {
        if (selector.includes('="unfollow"')) {
          const scoped = selector.startsWith('xpath=//*[@role="dialog"]//');
          assert.ok(scoped || selector.startsWith('xpath=//*['));
          return new Fields(() => Array.from(document.querySelectorAll(scoped ? '[role="dialog"] button' : 'button'))
            .filter(element => /^(unfollow|cancel request)$/i.test(element.textContent ?? '')) as unknown as Element[]);
        }
        return new Fields(() => [document.querySelector(selector.includes('="requested"') ? '#relationship' : '#follow')!] as unknown as Element[]);
      } } as unknown as Page;
      assert.equal(await unfollow(page, async () => true), true);
      assert.equal(clicked, layout === 'immediate' ? '' : layout === 'dialog' ? 'dialog-confirm' : 'page-confirm');
    } finally { await window.happyDOM.close(); }
  }
});
test('message composer prefers visible named fields and isolates overlay fallback', async () => {
  for (const hasNamed of [true, false]) {
    const window = new Window();
    try {
      window.document.body.innerHTML = `
        <div role="textbox" contenteditable="true" id="unrelated"></div>
        <div role="dialog"><div role="textbox" contenteditable="true" id="other-dialog"></div></div>
        <div data-pagelet="IGDChatTabsRootContentOffMsys">
          <div role="textbox" contenteditable="true" hidden id="hidden-overlay"></div>
          <div role="textbox" contenteditable="true" id="overlay"></div>
        </div>
        <textarea placeholder="Message..." hidden id="hidden-named"></textarea>
        ${hasNamed ? '<div role="textbox" aria-label="Message" contenteditable="true" id="named"></div>' : ''}`;
      const visible = (element: Element) => !element.hasAttribute('hidden');
      class Fields {
        constructor(readonly fields: Element[]) {}
        or(other: Fields) { return new Fields([...this.fields, ...other.fields]); }
        filter() { return new Fields(this.fields.filter(visible)); }
        first() { return { waitFor: async () => { assert.ok(this.fields.length, 'no visible composer'); } }; }
        async count() { return this.fields.length; }
        nth(index: number) {
          const element = this.fields[index]!;
          return { id: element.id, isVisible: async () => visible(element) };
        }
      }
      const page = { locator: (selector: string) => new Fields(Array.from(window.document.querySelectorAll(selector)) as unknown as Element[]) } as unknown as Page;
      assert.equal((await messageComposer(page) as unknown as { id: string }).id, hasNamed ? 'named' : 'overlay');
      window.document.querySelector('[data-pagelet]')!.remove();
      window.document.querySelector('#named')?.remove();
      await assert.rejects(messageComposer(page), /no visible composer/);
    } finally {
      await window.happyDOM.close();
    }
  }
});


test('DM readiness requires an approved Following relationship and a visible Message button', async () => {
  const { canMessageFollowedProfile } = await import('./follow.js');
  for (const [relationship, messageVisible, expected] of [
    ['Follow', true, false],
    ['Requested', true, false],
    ['Requested', false, false],
    ['Following', false, false],
    ['Following', true, true],
  ] as const) {
    let messageChecks = 0;
    const message = { waitFor: async () => {
      messageChecks++;
      if (!messageVisible) throw new errors.TimeoutError('Message unavailable');
    } };
    const following = {
      or() { return this; }, waitFor: async () => {},
      isVisible: async () => relationship !== 'Follow', innerText: async () => relationship,
    };
    const page = { locator: (selector: string) => selector.includes('="message"') ? message : following } as unknown as Page;
    assert.equal(await canMessageFollowedProfile(page), expected, relationship + '/' + messageVisible);
    if (relationship === 'Requested') assert.equal(messageChecks, 0, 'pending requests never open Message');
  }
});
