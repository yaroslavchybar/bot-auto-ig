import { visibleActionGeometry } from './actions/action-locator.test-support.js'
import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { type Page } from 'playwright-core';

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


test('live privacy and request state decide outreach without requiring a Message button', async () => {
  const { outreachProfileState } = await import('./follow.js');
  for (const [relationship, content, isPrivate, canMessage] of [
    ['Follow', 'This profile is private', true, false],
    ['Requested', 'This account is private', true, false],
    ['Requested', 'No posts yet', false, false],
    ['Follow', 'No posts yet', false, true],
    ['Following', 'posts', false, true],
  ] as const) {
    const window = new Window();
    try {
      const document = window.document;
      document.body.innerHTML = `<main><header><button>${relationship}</button></header>${content === 'posts'
        ? '<a href="/alice/p/current/">Photo</a>' : `<span>${content}</span>`}</main>`;
      class Fields {
        constructor(readonly find: () => Element[]) {}
        locator(selector: string) { return new Fields(() => this.find().flatMap(node => Array.from(node.querySelectorAll(selector)))); }
        getByText(text: string | RegExp) { return new Fields(() => this.find().flatMap(node => Array.from(node.querySelectorAll('span')))
          .filter(node => typeof text === 'string' ? node.textContent === text : text.test(node.textContent ?? ''))); }
        or(other: Fields) { return new Fields(() => [...new Set([...this.find(), ...other.find()])]); }
        first() { return new Fields(() => this.find().slice(0, 1)); }
        async isVisible() { return this.find().length > 0; }
        async waitFor() { assert.ok(await this.isVisible()); }
        async innerText() { assert.equal(this.find().length, 1); return this.find()[0]!.textContent; }
      }
      const page = { url: () => 'https://www.instagram.com/alice/', locator: (selector: string) => {
        if (selector.startsWith('xpath=')) return new Fields(() => Array.from(document.querySelectorAll('main header button'))
          .filter(node => selector.includes('="following"') ? /^(Following|Requested)$/.test(node.textContent ?? '') : node.textContent === 'Follow') as unknown as Element[]);
        return new Fields(() => Array.from(document.querySelectorAll(selector)) as unknown as Element[]);
      } } as unknown as Page;
      assert.deepEqual(await outreachProfileState(page, 'alice'), { isPrivate, canMessage });
      page.url = () => 'https://www.instagram.com/bob/';
      await assert.rejects(outreachProfileState(page, 'alice'), /navigation changed/);
    } finally { await window.happyDOM.close(); }
  }
});
