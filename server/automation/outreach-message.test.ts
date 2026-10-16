import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import type { Page } from 'playwright-core'
import { BrowseSession, SessionEnded } from './actions/session.js'
import { visibleActionGeometry } from './actions/action-locator.test-support.js'
import { openOutreachMessage, typeOutreachMessage, sendOutreachMessage, closeOutreachMessage } from './outreach-message.js'

function fixture() {
  const window = new Window()
  const document = window.document
  document.body.innerHTML = `<button id="message">Message</button>
    <button id="unrelated-close" aria-label="Close"></button>
    ${['other', 'alice'].map(username => `<div id="${username}" data-pagelet="IGDChatTabsRootContentOffMsys" ${username === 'alice' ? 'hidden' : ''}>
      <a href="/${username}/" aria-label="Open the profile page of ${username}"></a>
      <div id="${username}-editor" role="textbox" contenteditable="true"></div>
      <div id="${username}-send" role="button" aria-label="Send"><svg aria-label="Send"></svg></div>
      <div id="${username}-close" role="button"><svg aria-label="Close"></svg></div>
    </div>`).join('')}`
  const calls: string[] = []
  let stopped = false
  let afterCharacter = () => {}
  class Fields {
    constructor(readonly find: () => Element[]) {}
    filter() { return new Fields(() => this.find().filter(node => !node.closest('[hidden]'))) }
    last() { return new Fields(() => this.find().slice(-1)) }
    locator(selector: string) { return new Fields(() => this.find().flatMap(node => Array.from(node.querySelectorAll(selector)))) }
    getByRole(_role: string, { name }: { name: string }) {
      return new Fields(() => this.find().flatMap(node => Array.from(node.querySelectorAll('button,[role="button"]')))
        .filter(node => (node.getAttribute('aria-label') ?? node.querySelector('svg')?.getAttribute('aria-label')) === name))
    }
    one() { const nodes = this.find(); assert.equal(nodes.length, 1); return nodes[0]! }
    async isVisible() { return this.find().some(node => !node.closest('[hidden]')) }
    async waitFor({ state }: { state: string }) { assert.equal(await this.isVisible(), state !== 'hidden') }
    async elementHandle() {
      const node = this.one()
      return { ...visibleActionGeometry, hover: async () => {}, dispose: async () => {}, click: async () => {
        calls.push(node.id)
        if (node.id === 'message') document.querySelector('#alice')!.removeAttribute('hidden')
        if (node.id.endsWith('-close')) node.parentElement!.setAttribute('hidden', '')
      } }
    }
    async press(key: string) {
      calls.push(`key:${key}`)
      assert.notEqual(key, 'Enter', 'typing must never send a message')
      if (key === 'Backspace') this.one().textContent = ''
      if (key === 'Shift+Enter') this.one().textContent += '\n'
    }
    async pressSequentially(text: string, options: { delay: number }) {
      assert.ok(options.delay >= 40 && options.delay <= 110)
      this.one().textContent += text
      calls.push(`type:${text}`)
      afterCharacter()
    }
    async innerText() { return this.one().textContent ?? '' }
  }
  const page = { locator: (selector: string) => new Fields(() => Array.from(document.querySelectorAll(
    selector.startsWith('xpath=') ? '#message' : selector,
  )) as unknown as Element[]) } as unknown as Page
  return { window, document, calls, page, session: new BrowseSession(Date.now() + 60_000, () => stopped),
    stopAfterCharacter: () => { afterCharacter = () => { stopped = true } } }
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
    await closeOutreachMessage(f.page, 'alice', f.session)
    assert.equal(f.document.querySelector('#alice')!.hasAttribute('hidden'), true)
    assert.equal(f.document.querySelector('#other')!.hasAttribute('hidden'), false)
    assert.deepEqual(f.calls.filter(call => /-(send|close)$/.test(call)), ['alice-send', 'alice-close'])
    await closeOutreachMessage(f.page, 'alice', f.session)
    assert.equal(f.calls.filter(call => call === 'alice-close').length, 1)
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
