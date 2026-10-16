import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import type { Page } from 'playwright-core'
import { BrowseSession, SessionEnded } from './actions/session.js'
import { visibleActionGeometry } from './actions/action-locator.test-support.js'
import { openOutreachMessage, typeOutreachMessage, sendOutreachMessage, closeOutreachMessage, outreachMessagePopup } from './outreach-message.js'

function fixture(nested = false) {
  const window = new Window()
  const document = window.document
  document.body.innerHTML = `<button id="message">Message</button>
    <button id="unrelated-close" aria-label="Close"></button>
    <div id="chats">
    ${['other', 'alice'].map(username => `<div id="${username}" data-pagelet="IGDChatTabsRootContentOffMsys" ${username === 'alice' ? 'hidden' : ''}>
      <a href="/${username}/" aria-label="Open the profile page of ${username}"></a>
      ${nested ? '<div class="editor-controls">' : ''}
      <div id="${username}-editor" role="textbox" contenteditable="true"></div>
      <div id="${username}-send" role="button" aria-label="Send"><svg aria-label="Send"></svg></div>
      <div id="${username}-close" role="button"><svg aria-label="Close"></svg></div>
      ${nested ? '</div>' : ''}
    </div>`).join('')}</div>`
  const calls: string[] = []
  let stopped = false
  let afterCharacter = () => {}
  let afterSelectAll = () => {}
  class Fields {
    constructor(readonly find: () => Element[], readonly keyboardSupported = true) {}
    filter(options: { visible?: boolean; has?: Fields }) {
      return new Fields(() => this.find().filter(node =>
        (!options.visible || !node.closest('[hidden]')) &&
        (!options.has || options.has.find().some(link => node.contains(link)))), false)
    }
    last() { return new Fields(() => this.find().slice(-1), false) }
    locator(selector: string) {
      if (selector.startsWith('xpath=ancestor::')) return new Fields(() => this.find().flatMap(node => {
        const ancestors: Element[] = []
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          const closes = Array.from(parent.querySelectorAll('button,[role="button"]'))
            .filter(control => control.getAttribute('aria-label') === 'Close' || control.querySelector('[aria-label="Close"]'))
          if (parent.matches('div') && parent.querySelector('[aria-label="Close"]') &&
            (!selector.includes('count(') || closes.length === 1 &&
              parent.querySelectorAll('[role="textbox"][contenteditable="true"]').length === 1))
            ancestors.push(parent)
        }
        return selector.endsWith('[1]') ? ancestors.slice(0, 1) : ancestors.reverse()
      }), false)
      return new Fields(() => this.find().flatMap(node => Array.from(node.querySelectorAll(selector))), false)
    }
    getByRole(_role: string, { name }: { name: string }) {
      return new Fields(() => this.find().flatMap(node => Array.from(node.querySelectorAll('button,[role="button"]')))
        .filter(node => (node.getAttribute('aria-label') ?? node.querySelector('svg')?.getAttribute('aria-label')) === name))
    }
    one() { const nodes = this.find(); assert.equal(nodes.length, 1); return nodes[0]! }
    page() { return page }
    async evaluate<T, A>(fn: (node: Element, arg: A) => T, arg: A) { return fn(this.one(), arg) }
    async evaluateAll<T>(fn: (nodes: Element[]) => T) { return fn(this.find()) }
    async isVisible() { return this.find().some(node => !node.closest('[hidden]')) }
    async count() { return this.find().length }
    async waitFor({ state }: { state: string }) { assert.equal(await this.isVisible(), state !== 'hidden') }
    async elementHandle() {
      const node = this.one()
      return { ...visibleActionGeometry, hover: async () => {}, dispose: async () => {},
        innerText: async () => node.textContent || '\n',
        evaluate: async <T>(fn: (element: Element) => T) => fn.name === 'scrollBounds'
          ? visibleActionGeometry.evaluate(fn) : fn(node),
        click: async () => {
        calls.push(node.id)
        if (node.getAttribute('role') === 'textbox') (node as HTMLElement).focus()
        if (node.id === 'message') document.querySelector('#alice')!.removeAttribute('hidden')
        if (node.id.endsWith('-close')) node.closest('#alice,#other')!.setAttribute('hidden', '')
      } }
    }
    async press(key: string) {
      assert.equal(this.keyboardSupported, true, 'Cloak rejects chained keyboard selectors')
      calls.push(`key:${key}`)
      assert.notEqual(key, 'Enter', 'typing must never send a message')
      if (key === 'ControlOrMeta+A') afterSelectAll()
      if (key === 'Backspace') this.one().textContent = ''
      if (key === 'Shift+Enter') this.one().textContent += '\n'
    }
    async pressSequentially(text: string, options: { delay: number }) {
      assert.equal(this.keyboardSupported, true, 'Cloak rejects chained keyboard selectors')
      assert.ok(options.delay >= 40 && options.delay <= 110)
      this.one().textContent += text
      calls.push(`type:${text}`)
      afterCharacter()
    }
    async innerText() { return this.one().textContent ?? '' }
  }
  const page = { keyboard: {
    press: async (key: string) => new Fields(() => [document.activeElement! as unknown as Element]).press(key),
    type: async (text: string, options: { delay: number }) => new Fields(() => [document.activeElement! as unknown as Element]).pressSequentially(text, options),
  }, locator: (selector: string) => new Fields(() => Array.from(document.querySelectorAll(
    selector.startsWith('xpath=') ? '#message' : selector,
  )) as unknown as Element[]) } as unknown as Page
  return { window, document, calls, page, session: new BrowseSession(Date.now() + 60_000, () => stopped),
    stopAfterCharacter: () => { afterCharacter = () => { stopped = true } },
    loseFocusAfterSelectAll: () => { afterSelectAll = () => { document.querySelector<HTMLElement>('#other-editor')!.focus() } },
    loseFocusAfterCharacter: () => { afterCharacter = () => { document.querySelector<HTMLElement>('#other-editor')!.focus() } } }
}

test('DM controls stay in the recipient popup; keyboard newlines never send; Close leaves other chats open', async () => {
  const f = fixture()
  try {
    const composer = await openOutreachMessage(f.page, 'alice', f.session)
    await typeOutreachMessage(composer, 'Hello 👋\r\nAlice', f.session)
    assert.equal(f.document.querySelector('#alice-editor')!.textContent, 'Hello 👋\nAlice')
    assert.equal(f.document.querySelector('#other-editor')!.textContent, '')
    assert.ok(!f.calls.includes('alice-send'))
    await sendOutreachMessage(f.page, 'alice', f.session)
    await typeOutreachMessage(composer, '', f.session)
    assert.equal(f.document.querySelector('#alice-editor')!.textContent, '')
    await closeOutreachMessage(f.page, 'alice', f.session)
    assert.equal(f.document.querySelector('#alice')!.hasAttribute('hidden'), true)
    assert.equal(f.document.querySelector('#other')!.hasAttribute('hidden'), false)
    assert.deepEqual(f.calls.filter(call => /-(send|close)$/.test(call)), ['alice-send', 'alice-close'])
    await closeOutreachMessage(f.page, 'alice', f.session)
    assert.equal(f.calls.filter(call => call === 'alice-close').length, 1)
  } finally { await f.window.happyDOM.close() }
})

test('recipient detection supports changed containers, translated labels and absolute profile links', async () => {
  const f = fixture()
  try {
    const popup = f.document.querySelector('#alice')!
    popup.removeAttribute('data-pagelet')
    popup.querySelector('a')!.setAttribute('aria-label', 'Öffne das Profil')
    popup.querySelector('a')!.setAttribute('href', 'https://www.instagram.com/alice/')
    await openOutreachMessage(f.page, 'alice', f.session)
    await closeOutreachMessage(f.page, 'alice', f.session)
    assert.ok(f.calls.includes('alice-close'))
    assert.ok(!f.calls.includes('other-close'))
  } finally { await f.window.happyDOM.close() }
})

test('a loading recipient chat never borrows a neighboring chat editor', async () => {
  const f = fixture()
  try {
    f.document.querySelector('#alice')!.removeAttribute('hidden')
    f.document.querySelector('#alice-editor')!.remove()
    assert.equal(await outreachMessagePopup(f.page, 'alice').count(), 0)
  } finally { await f.window.happyDOM.close() }
})

test('nested editor controls still resolve the recipient chat, Send and Close', async () => {
  const f = fixture(true)
  try {
    const composer = await openOutreachMessage(f.page, 'alice', f.session)
    await typeOutreachMessage(composer, 'Hello', f.session)
    await sendOutreachMessage(f.page, 'alice', f.session)
    await closeOutreachMessage(f.page, 'alice', f.session)
    assert.equal(f.document.querySelector('#alice-editor')!.textContent, 'Hello')
    assert.equal(f.document.querySelector('#other-editor')!.textContent, '')
    assert.equal(f.document.querySelector('#alice')!.hasAttribute('hidden'), true)
    assert.equal(f.document.querySelector('#other')!.hasAttribute('hidden'), false)
    assert.deepEqual(f.calls.filter(call => /-(send|close)$/.test(call)), ['alice-send', 'alice-close'])
  } finally { await f.window.happyDOM.close() }
})

test('cancellation stops keyboard typing before the next character or Send', async () => {
  const f = fixture()
  try {
    const composer = await openOutreachMessage(f.page, 'alice', f.session)
    f.stopAfterCharacter()
    await assert.rejects(typeOutreachMessage(composer, 'Hello', f.session), SessionEnded)
    assert.equal(f.document.querySelector('#alice-editor')!.textContent, 'H')
    assert.ok(!f.calls.includes('alice-send'))
  } finally { await f.window.happyDOM.close() }
})

test('typing stops if keyboard focus moves to another recipient', async () => {
  const f = fixture()
  try {
    const composer = await openOutreachMessage(f.page, 'alice', f.session)
    f.loseFocusAfterCharacter()
    await assert.rejects(typeOutreachMessage(composer, 'Hello', f.session), /lost keyboard focus/)
    assert.equal(f.document.querySelector('#alice-editor')!.textContent, 'H')
    assert.equal(f.document.querySelector('#other-editor')!.textContent, '')
    assert.ok(!f.calls.includes('alice-send'))
  } finally { await f.window.happyDOM.close() }
})

for (const message of ['Hello', '']) {
  test(`focus loss after Select All prevents Backspace for ${message ? 'a new message' : 'an empty message'}`, async () => {
    const f = fixture()
    try {
      const composer = await openOutreachMessage(f.page, 'alice', f.session)
      f.document.querySelector('#alice-editor')!.textContent = 'Recipient draft'
      f.document.querySelector('#other-editor')!.textContent = 'Other draft'
      f.loseFocusAfterSelectAll()
      await assert.rejects(typeOutreachMessage(composer, message, f.session), /lost keyboard focus/)
      assert.equal(f.document.querySelector('#alice-editor')!.textContent, 'Recipient draft')
      assert.equal(f.document.querySelector('#other-editor')!.textContent, 'Other draft')
      assert.deepEqual(f.calls.filter(call => call.startsWith('key:')), ['key:ControlOrMeta+A'])
      assert.ok(!f.calls.some(call => call.startsWith('type:') || call.endsWith('-send')))
    } finally { await f.window.happyDOM.close() }
  })
}
