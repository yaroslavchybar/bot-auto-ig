import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import type { Page } from 'playwright-core'
import { assertInstagramReady, checkNotifications } from './instagram-state.js'
import { BrowseSession } from './session.js'

test('Instagram warnings ignore content and hidden alerts but stop on visible limits', async () => {
  const window = new Window()
  try {
    const page = { url: () => 'https://www.instagram.com/', locator: (selector: string) => ({
      filter: () => ({ evaluateAll: async (fn: (elements: Element[]) => unknown) => fn(
        Array.from(window.document.querySelectorAll(selector)).filter(element => !element.closest('[hidden]')) as unknown as Element[]) }),
    }) } as unknown as Page
    for (const html of [
      '<article>Try again later</article>',
      '<div role="dialog"><article>Unusual activity <video></video></article></div>',
      '<div role="alert" hidden>Action blocked</div>',
      '<div role="dialog">Turn on notifications</div>',
    ]) {
      window.document.body.innerHTML = html
      await assertInstagramReady(page)
    }
    window.document.body.innerHTML = '<div role="alert">We limit how often you can do this</div>'
    await assert.rejects(assertInstagramReady(page), /Instagram limit needs attention/)
    window.document.body.innerHTML = '<div role="alertdialog">Help us confirm it\'s you</div>'
    await assert.rejects(assertInstagramReady(page), /Instagram checkpoint needs attention/)
  } finally { await window.happyDOM.close() }
})

test('login and checkpoint URLs stop before any DOM action', async () => {
  for (const path of ['/accounts/login/', '/challenge/123/', '/checkpoint/', '/accounts/suspended/'])
    await assert.rejects(assertInstagramReady({ url: () => `https://www.instagram.com${path}` } as Page), /needs attention/)
})

test('notification checks close their own panel instead of a DM composer', async () => {
  const clicks: string[] = []
  const action = (name: string) => ({ isVisible: async () => true,
    elementHandle: async () => ({ hover: async () => {}, click: async () => { clicks.push(name) }, dispose: async () => {} }) })
  const close = { ...action('notification-close'), filter() { return this }, first() { return this } }
  const heading = { waitFor: async () => {}, locator: (selector: string) => {
    assert.ok(selector.startsWith('xpath=ancestor::'))
    return { getByRole: () => close }
  } }
  const page = { url: () => 'https://www.instagram.com/',
    locator: () => ({ filter: () => ({ evaluateAll: async () => null }) }),
    getByRole: (role: string) => {
      if (role === 'link') return action('notifications')
      if (role === 'heading') return heading
      throw new Error('Must not select a global Close button')
    },
  } as unknown as Page
  const session = new BrowseSession()
  session.wait = async () => {}
  assert.equal(await checkNotifications(page, () => {}, session), true)
  assert.deepEqual(clicks, ['notifications', 'notification-close'])
})
