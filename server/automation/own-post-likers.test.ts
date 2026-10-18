import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import type { Page } from 'playwright-core'
import { discoverOwnPosts, mediaIdFromCode } from './own-post-likers.js'
import { BrowseSession } from './actions/session.js'

test('post shortcode conversion is lossless and rejects non-post input', () => {
  assert.equal(mediaIdFromCode('B'), '1')
  assert.equal(mediaIdFromCode('BA'), '64')
  assert.equal(mediaIdFromCode('___________'), '73786976294838206463')
  for (const code of ['', 'a/b', 'x'.repeat(12)]) assert.throws(() => mediaIdFromCode(code))
})

test('post discovery navigates to the signed-in owner and deduplicates only main profile post tiles', async () => {
  const window = new Window()
  window.document.body.innerHTML = `<nav><a href="/owner/"><img alt="owner's profile picture"></a></nav>
    <main><header><a href="/owner/">owner</a></header><a href="/owner/p/B/">One</a><a href="/owner/p/B/">Duplicate</a>
    <a href="/owner/reel/C/">Two</a><a href="/elsewhere/p/D/">Other account</a></main>`
  let url = 'https://www.instagram.com/',
    visited = ''
  const page = {
    locator: (selector: string) => ({
      filter() {
        return this
      },
      first() {
        return this
      },
      or() {
        return this
      },
      waitFor: async () => {},
      getByRole: (_role: string, options: { name: string }) => {
        assert.equal(options.name, 'owner')
        return {
          first() {
            return this
          },
          waitFor: async () => {},
        }
      },
      evaluateAll: async (fn: (nodes: unknown[]) => unknown) =>
        fn([...window.document.querySelectorAll(selector)]),
    }),
    goto: async (target: string) => {
      visited = target
      url = target
    },
    url: () => url,
    getByText: () => ({}),
    viewportSize: () => ({ width: 1366, height: 768 }),
    evaluate: async () => ({ bottom: true, height: 1000, loading: false, viewport: 768 }),
    mouse: { move: async () => {}, wheel: async () => {} },
  } as unknown as Page
  const session = new BrowseSession()
  session.wait = async () => {}
  try {
    assert.deepEqual(await discoverOwnPosts(page, session), [
      { id: '1', code: 'B' },
      { id: '2', code: 'C' },
    ])
    assert.equal(visited, 'https://www.instagram.com/owner/')
  } finally {
    await window.happyDOM.close()
  }
})
