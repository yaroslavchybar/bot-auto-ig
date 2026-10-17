import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import type { Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { BrowseSession, SessionEnded } from './actions/session.js'
import { visibleActionGeometry } from './actions/action-locator.test-support.js'
import { openOutreachMessage, typeOutreachMessage, sendOutreachMessage, closeOutreachMessage, outreachMessagePopup } from './outreach-message.js'

function fixture(nested = false, entry: 'button' | 'menu-overlay' | 'menu-inbox' | 'menu-inbox-root' = 'button',
  restored: 'chat' | 'messages' | 'delayed-chat' | 'delayed-messages' | 'none' = 'chat') {
  const window = new Window()
  const document = window.document
  document.body.innerHTML = `<main id="profile"><header>
    <button id="message" ${entry === 'button' ? '' : 'hidden'}>Message</button>
    <button id="options" aria-label="Options" aria-expanded="false"></button></header></main>
    <div role="dialog" id="menu" hidden><button id="menu-message">Send message</button></div>
    <button id="unrelated-close" aria-label="Close"></button>
    <div id="chats">
    ${['other', 'alice'].map(username => `<div id="${username}" data-pagelet="IGDChatTabsRootContentOffMsys" ${username === 'alice' ? 'hidden' : ''}>
      <a id="${username}-profile" href="/${username}/" aria-label="Open the profile page of ${username}"></a>
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
  let afterProfileClick = () => {}
  let restorePopup = () => {}
  let url = 'https://www.instagram.com/alice/'
  const close = document.querySelector('#alice-close')!
  class Fields {
    constructor(readonly find: () => Element[], readonly keyboardSupported = true) {}
    filter(options: { visible?: boolean; has?: Fields; hasText?: RegExp; hasNotText?: RegExp }) {
      return new Fields(() => this.find().filter(node =>
        (!options.visible || !node.closest('[hidden]')) &&
        (!options.hasText || options.hasText.test(node.textContent ?? '')) &&
        (!options.hasNotText || !options.hasNotText.test(node.textContent ?? '')) &&
        (!options.has || options.has.find().some(link => node.contains(link)))), false)
    }
    last() { return new Fields(() => this.find().slice(-1), false) }
    first() { return new Fields(() => this.find().slice(0, 1), false) }
    or(other: Fields) { return new Fields(() => [...new Set([...this.find(), ...other.find()])], false) }
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
    getByRole(role: string, { name }: { name?: string } = {}) {
      if (role === 'dialog') return new Fields(() => this.find().flatMap(node => Array.from(node.querySelectorAll('[role="dialog"]'))))
      if (role === 'heading') return new Fields(() => this.find().flatMap(node => Array.from(node.querySelectorAll('h1,h2,h3,[role="heading"]')))
        .filter(node => node.textContent === name))
      return new Fields(() => this.find().flatMap(node => Array.from(node.querySelectorAll('button,[role="button"]')))
        .filter(node => (node.getAttribute('aria-label') ?? node.querySelector('svg')?.getAttribute('aria-label') ?? node.textContent) === name))
    }
    one() { const nodes = this.find(); assert.equal(nodes.length, 1); return nodes[0]! }
    page() { return page }
    async evaluate<T, A>(fn: (node: Element, arg: A) => T, arg: A) { return fn(this.one(), arg) }
    async evaluateAll<T>(fn: (nodes: Element[]) => T) { return fn(this.find()) }
    async isVisible() { return this.find().some(node => !node.closest('[hidden]')) }
    async count() { return this.find().length }
    async getAttribute(name: string) { return this.one().getAttribute(name) }
    async waitFor({ state }: { state: string }) {
      if (await this.isVisible() !== (state !== 'hidden')) restorePopup()
      if (await this.isVisible() !== (state !== 'hidden')) throw new errors.TimeoutError('Fixture target did not become ' + state)
    }
    async elementHandle() {
      const node = this.one()
      return { ...visibleActionGeometry, hover: async () => {}, dispose: async () => {},
        innerText: async () => node.textContent || '\n',
        evaluate: async <T>(fn: (element: Element) => T) => fn.name === 'scrollBounds'
          ? visibleActionGeometry.evaluate(fn) : fn(node),
        click: async () => {
        calls.push(node.id)
        if (node.getAttribute('role') === 'textbox') (node as HTMLElement).focus()
        if (node.id === 'options') {
          const menu = document.querySelector('#menu')!
          menu.toggleAttribute('hidden')
          node.setAttribute('aria-expanded', String(!menu.hasAttribute('hidden')))
        }
        if (node.id === 'message' || node.id === 'menu-message') document.querySelector('#alice')!.removeAttribute('hidden')
        if (node.id === 'menu-message') {
          document.querySelector('#menu')!.setAttribute('hidden', '')
          document.querySelector('#options')!.setAttribute('aria-expanded', 'false')
          if (entry === 'menu-inbox' || entry === 'menu-inbox-root') {
            const inbox = document.createElement('main')
            inbox.id = 'inbox'
            inbox.innerHTML = '<nav aria-label="Thread list"></nav>'
            inbox.append(document.querySelector('#alice')!)
            document.body.append(inbox)
            close.remove()
            document.querySelector('#profile')!.setAttribute('hidden', '')
            url = entry === 'menu-inbox' ? 'https://www.instagram.com/direct/t/123/' : 'https://www.instagram.com/direct/inbox/'
          }
        }
        if (node.id === 'alice-profile' || node.id === 'alice-view-profile') {
          assert.ok(url.includes('/direct/'), 'The native profile link is used only to leave the inbox')
          url = 'https://www.instagram.com/alice/'
          const chat = document.querySelector('#alice')!
          chat.append(close)
          document.querySelector('#chats')!.append(chat)
          document.querySelector('#inbox')!.remove()
          document.querySelector('#profile')!.removeAttribute('hidden')
          if (restored !== 'chat') chat.setAttribute('hidden', '')
          const showPopup = () => {
            if (restored === 'delayed-chat') chat.removeAttribute('hidden')
            else if (restored.includes('messages')) {
              const panel = document.createElement('div')
              panel.id = 'messages-panel'
              panel.innerHTML = '<div><h3>Messages</h3><button aria-label="Expand"></button><button id="messages-close" aria-label="Close"></button></div><p>No chats</p>'
              document.body.append(panel)
            }
          }
          if (restored.startsWith('delayed-')) restorePopup = () => {
            calls.push('wait-restored-popup')
            restorePopup = () => {}
            showPopup()
          }
          else showPopup()
          afterProfileClick()
        }
        if (node.id === 'messages-close') document.querySelector('#messages-panel')!.remove()
        else if (node.id.endsWith('-close')) node.closest('#alice,#other')!.setAttribute('hidden', '')
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
  const page = { url: () => url,
    goBack: async () => { assert.fail('Inbox cleanup must click the native profile link') },
    goto: async () => { assert.fail('Inbox cleanup must not navigate to a constructed profile URL') },
    waitForURL: async (matches: (url: URL) => boolean) => assert.ok(matches(new URL(url))),
    getByRole: (role: string, options: { name?: string }) => new Fields(() => [document.body] as unknown as Element[]).getByRole(role, options),
    keyboard: {
    press: async (key: string) => new Fields(() => [document.activeElement! as unknown as Element]).press(key),
    type: async (text: string, options: { delay: number }) => new Fields(() => [document.activeElement! as unknown as Element]).pressSequentially(text, options),
  }, locator: (selector: string) => new Fields(() => Array.from(document.querySelectorAll(
    selector.startsWith('xpath=') ? '#message' : selector,
  )) as unknown as Element[]) } as unknown as Page
  return { window, document, calls, page, session: new BrowseSession(Date.now() + 60_000, () => stopped),
    stopAfterCharacter: () => { afterCharacter = () => { stopped = true } },
    stopAfterProfileClick: () => { afterProfileClick = () => { stopped = true } },
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

for (const entry of ['menu-overlay', 'menu-inbox', 'menu-inbox-root'] as const) {
  test(`a profile without Message opens through Options and cleans up ${entry}`, async () => {
    const f = fixture(false, entry)
    try {
      const composer = await openOutreachMessage(f.page, 'alice', f.session)
      await typeOutreachMessage(composer, 'Hello', f.session)
      await sendOutreachMessage(f.page, 'alice', f.session)
      assert.equal(f.document.querySelector('#alice-editor')!.textContent, 'Hello')
      assert.equal(f.document.querySelector('#other-editor')!.textContent, '')
      await closeOutreachMessage(f.page, 'alice', f.session)
      assert.equal(f.page.url(), 'https://www.instagram.com/alice/')
      assert.equal(f.calls.includes('alice-profile'), entry !== 'menu-overlay')
      assert.equal(f.document.querySelector('#alice')!.hasAttribute('hidden'), true)
      assert.equal(f.document.querySelector('#other')!.hasAttribute('hidden'), false)
      assert.deepEqual(f.calls.filter(call => ['message', 'options', 'menu-message', 'alice-send', 'alice-close'].includes(call)),
        ['options', 'menu-message', 'alice-send', 'alice-close'])
    } finally { await f.window.happyDOM.close() }
  })
}

for (const [draw, expected, unavailable] of [
  [0.49, 'alice-view-profile', null],
  [0.5, 'alice-profile', null],
  [0.49, 'alice-profile', 'alice-view-profile'],
  [0.5, 'alice-view-profile', 'alice-profile'],
] as const) {
  test(`profile return chooses ${expected} for roll ${draw}${unavailable ? ` when ${unavailable} is missing` : ''}`, async () => {
    const f = fixture(false, 'menu-inbox-root')
    const originalRandom = Math.random
    try {
      await openOutreachMessage(f.page, 'alice', f.session)
      const link = f.document.createElement('a')
      link.id = 'alice-view-profile'
      link.href = '/alice/'
      link.textContent = 'View profile'
      f.document.querySelector('#alice')!.append(link)
      if (unavailable) f.document.querySelector(`#${unavailable}`)!.remove()
      Math.random = () => draw
      await closeOutreachMessage(f.page, 'alice', f.session)
      assert.deepEqual(f.calls.filter(call => call === 'alice-profile' || call === 'alice-view-profile'), [expected])
      assert.ok(f.calls.includes('alice-close'))
      assert.equal(f.page.url(), 'https://www.instagram.com/alice/')
    } finally { Math.random = originalRandom; await f.window.happyDOM.close() }
  })
}

for (const restored of ['messages', 'delayed-messages', 'delayed-chat', 'none'] as const) {
  test(`inbox cleanup clicks the recipient profile and closes the restored ${restored}`, async () => {
    const f = fixture(false, 'menu-inbox-root', restored)
    try {
      await openOutreachMessage(f.page, 'alice', f.session)
      await sendOutreachMessage(f.page, 'alice', f.session)
      if (restored.includes('messages')) f.document.querySelector('#alice-editor')!.remove()
      await closeOutreachMessage(f.page, 'alice', f.session)
      assert.equal(f.page.url(), 'https://www.instagram.com/alice/')
      assert.equal(f.calls.filter(call => call === 'alice-profile').length, 1)
      assert.equal(f.calls.includes('wait-restored-popup'), restored.startsWith('delayed-'))
      assert.equal(f.calls.includes('messages-close'), restored.includes('messages'))
      assert.equal(f.calls.includes('alice-close'), restored === 'delayed-chat')
      assert.equal(f.document.querySelector('#messages-panel'), null)
      assert.equal(f.document.querySelector('#alice')!.hasAttribute('hidden'), true)
      assert.ok(!f.calls.includes('other-close'))
      assert.ok(!f.calls.includes('unrelated-close'))
    } finally { await f.window.happyDOM.close() }
  })
}

test('cancellation after the profile click prevents popup cleanup input', async () => {
  const f = fixture(false, 'menu-inbox-root', 'messages')
  try {
    await openOutreachMessage(f.page, 'alice', f.session)
    f.stopAfterProfileClick()
    await assert.rejects(closeOutreachMessage(f.page, 'alice', f.session), SessionEnded)
    assert.ok(f.calls.includes('alice-profile'))
    assert.ok(!f.calls.includes('messages-close'))
    assert.ok(f.document.querySelector('#messages-panel'))
  } finally { await f.window.happyDOM.close() }
})

test('a surviving Messages panel makes cleanup fail instead of closing unrelated controls', async () => {
  const f = fixture(false, 'menu-inbox-root', 'messages')
  try {
    await openOutreachMessage(f.page, 'alice', f.session)
    const click = f.page.waitForURL.bind(f.page)
    f.page.waitForURL = async (...args) => {
      await click(...args)
      f.document.querySelector('#messages-close')!.remove()
    }
    await assert.rejects(closeOutreachMessage(f.page, 'alice', f.session))
    assert.ok(f.document.querySelector('#messages-panel'))
    assert.ok(!f.calls.includes('other-close'))
    assert.ok(!f.calls.includes('unrelated-close'))
  } finally { await f.window.happyDOM.close() }
})

test('failed menu messaging leaves the profile menu closed during cleanup', async () => {
  const f = fixture(false, 'menu-overlay')
  try {
    f.document.querySelector('#menu-message')!.remove()
    await assert.rejects(openOutreachMessage(f.page, 'alice', f.session))
    await closeOutreachMessage(f.page, 'alice', f.session)
    assert.equal(f.document.querySelector('#menu')!.hasAttribute('hidden'), true)
    assert.ok(!f.calls.includes('alice-send'))
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
