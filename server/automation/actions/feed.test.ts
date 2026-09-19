import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { browseFeed, visibleFeedPost } from './feed.js'

function pageWithPosts(tops: number[]) {
  const posts = tops.map((y, index) => ({
    boundingBox: async () => ({ x: 0, y, width: 500, height: 250 }),
    locator: () => ({ first: () => ({ getAttribute: async () => `/p/post${index}/` }) }),
  }))
  return {
    viewportSize: () => ({ width: 1280, height: 800 }),
    locator: () => ({ count: async () => posts.length, nth: (i: number) => posts[i] }),
  } as unknown as Page
}

test('finds visible posts beyond the first six articles', async () => {
  const result = await visibleFeedPost(pageWithPosts([-3000, -2500, -2000, -1500, -1000, -500, 100]), new Set())
  assert.equal(result?.id, 'post6')
})

test('prefers unread visible posts and never falls back to an offscreen article', async () => {
  const page = pageWithPosts([-500, 100, 400])
  assert.equal((await visibleFeedPost(page, new Set(['post1'])))?.id, 'post2')
  assert.equal((await visibleFeedPost(page, new Set(['post1', 'post2'])))?.id, 'post2')
  assert.equal(await visibleFeedPost(pageWithPosts([-500, 900]), new Set()), null)
})

test('zero budget never navigates the browser', async () => {
  const page = { goto: async () => { throw new Error('Must not navigate') } } as unknown as Page
  assert.equal(await browseFeed(page, 0, {}, () => {}, () => false), 'stopped')
})
