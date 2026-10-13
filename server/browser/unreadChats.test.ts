import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import type { BrowserContext } from 'playwright-core'
import { unreadChatsFromDocument, saveUnreadChatsAtClose } from './unreadChats.js'

function fixture(html: string) {
  const window = new Window({ url: 'https://www.instagram.com/' })
  window.document.body.innerHTML = html
  for (const node of window.document.querySelectorAll('*')) {
    node.getBoundingClientRect = () => ({ width: node.closest('[hidden]') ? 0 : 24, height: 24 }) as DOMRect
  }
  return window
}

for (const [html, expected] of [
  ['<div aria-label="Messages - 8 new notifications"><svg aria-label="8 unread chats"></svg></div>', 8],
  ['<a href="/direct/inbox/"><svg aria-label="Messages"></svg><div aria-label="Direct messaging - 8 new notifications link">8</div></a>', 8],
  ['<div aria-label="Messages - 1 new notifications"><svg aria-label="1 unread chat"></svg></div>', 1],
  ['<div aria-label="Messages - 1 new notification"></div>', 1],
  ['<div aria-label="Messages -   new notifications"></div>', null],
  ['<div aria-label="Messages - 1,234 new notifications"><svg aria-label="1,234 unread chats"></svg></div>', 1234],
  ['<div aria-label="Messages - 8 new notifications"></div><div aria-label="Messages - 8 new notifications"></div>', 8],
  ['<a href="/direct/inbox/"><svg aria-label="Messages"></svg></a>', 0],
  ['<button aria-label="Notifications - 19 new notifications">19</button>', null],
  ['<div hidden><svg aria-label="8 unread chats"></svg></div><a href="/direct/inbox/"><svg aria-label="Messages"></svg></a>', 0],
  ['<div aria-label="Messages - 8 new notifications"><svg aria-label="8 unread chats"></svg><svg aria-label="9 unread chats"></svg></div>', null],
  ['<div aria-label="Messages - 99+ new notifications"></div>', null],
  ['<article><img aria-label="99 unread chats"></article><a href="/direct/inbox/"><svg aria-label="Messages"></svg></a>', 0],
  ['<div>Page is loading</div>', null],
] as const) test(`reads only known message badges: ${html}`, async () => {
  const window = fixture(html)
  try { assert.equal(unreadChatsFromDocument(window.document as unknown as Document), expected) }
  finally { await window.happyDOM.close() }
})

test('shutdown saves the browser count without navigation and does not count notifications', async () => {
  const window = fixture('<a href="/direct/inbox/"><svg aria-label="Messages"></svg><div aria-label="Direct messaging - 8 new notifications link">8</div></a>')
  const saved: number[] = []
  const context = { pages: () => [{ isClosed: () => false, url: () => 'https://www.instagram.com/explore/',
    evaluate: async (source: string) => window.eval(source),
    goto: () => { throw new Error('Must never navigate to fetch unread chats') },
  }] } as unknown as BrowserContext
  try {
    await saveUnreadChatsAtClose(context, 'profile', { save: async (profileId, count, checkedAt) => {
      assert.equal(profileId, 'profile'); assert.ok(checkedAt > 0); saved.push(count)
    } })
    assert.deepEqual(saved, [8])
  } finally { await window.happyDOM.close() }
})

for (const url of ['https://www.instagram.com/accounts/login/', 'https://www.instagram.com/challenge/123/', 'about:blank'])
  test(`shutdown leaves the last count unchanged on ${url}`, async () => {
    const context = { pages: () => [{ isClosed: () => false, url: () => url,
      evaluate: () => { throw new Error('Do not read this page') },
    }] } as unknown as BrowserContext
    await saveUnreadChatsAtClose(context, 'profile', { save: async () => { throw new Error('Do not overwrite the saved count') } })
  })

test('missing UI and save failures do not interrupt browser cleanup', async () => {
  for (const count of [null, 8]) {
    let attempts = 0
    const context = { pages: () => [{ isClosed: () => false, url: () => 'https://www.instagram.com/', evaluate: async () => count }] } as unknown as BrowserContext
    await saveUnreadChatsAtClose(context, 'profile', { save: async () => { attempts++; throw new Error('Database unavailable') } })
    assert.equal(attempts, count === null ? 0 : 1)
  }
})
