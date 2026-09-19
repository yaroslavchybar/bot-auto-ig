import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Locator, Page } from 'playwright-core'
import { BrowseSession, SessionEnded } from './session.js'
import { settleOnPost, smoothScroll } from './scroll.js'
import { likeVisible, clickVisible } from './mouse.js'
import { detourDelay, postChoices, viewContent, viewVideo } from './viewing.js'
import { openDMs } from './inbox.js'
import { openReels } from './reels.js'
import { backToFeed } from './navigation.js'
import { openOwnProfile } from './profiles.js'

test('settling checks posts beyond six and ignores fully offscreen posts', async () => {
  const checked: number[] = []
  let wheelCalls = 0
  const posts = [-1800, -1500, -1200, -900, -600, -300, 100].map((y, i) => ({
    boundingBox: async () => { checked.push(i); return { x: 0, y, width: 400, height: 250 } },
  }))
  const page = {
    viewportSize: () => ({ width: 1280, height: 800 }),
    locator: () => ({ count: async () => posts.length, nth: (i: number) => posts[i] }),
    mouse: { wheel: async () => { wheelCalls++ } },
  } as unknown as Page
  await settleOnPost(page)
  assert.equal(wheelCalls, 0)
  assert.ok(checked.includes(6))
  posts.pop()
  await settleOnPost(page)
  assert.equal(wheelCalls, 0)
})

test('post choices roll exactly once per action', () => {
  const original = Math.random
  let rolls = 0
  Math.random = () => { rolls++; return 0.5 }
  try {
    assert.deepEqual(postChoices({ like_chance: 100, follow_chance: 0, carousel_watch_chance: 20 }),
      { like: true, follow: false, carousel: false })
    assert.equal(rolls, 3)
  } finally { Math.random = original }
})

test('detour spacing scales with session length and has a minimum', () => {
  assert.equal(detourDelay(300_000), 75_000)
  assert.equal(detourDelay(600_000), 150_000)
  assert.equal(detourDelay(10_000), 30_000)
})

test('one deadline caps waits and prevents actions after expiry', async () => {
  const session = new BrowseSession(Date.now() + 20)
  assert.ok(session.timeout(10_000) <= 20)
  await assert.rejects(session.wait(10_000), SessionEnded)
  assert.throws(() => session.timeout(5_000), SessionEnded)
  const page = {} as Page
  await assert.rejects(smoothScroll(page, 500, session), SessionEnded)
  await assert.rejects(openDMs(page, () => {}, session), SessionEnded)
  await assert.rejects(openReels(page, () => {}, session), SessionEnded)
  await assert.rejects(openOwnProfile(page, () => {}, session), SessionEnded)
  await assert.rejects(backToFeed(page, () => {}, session), SessionEnded)
})

test('stop interrupts a long wait instead of waiting out the duration', async () => {
  let stopped = false
  const session = new BrowseSession(Infinity, () => stopped)
  const pending = session.wait(60_000)
  stopped = true
  await assert.rejects(pending, SessionEnded)
})

test('photos finish their viewing wait before returning', async () => {
  const session = new BrowseSession()
  const waits: number[] = []
  session.wait = async ms => { waits.push(ms) }
  const target = { locator: () => ({ first: () => ({ count: async () => 0 }) }) } as unknown as Locator
  assert.equal(await viewContent(target, 2400, session), true)
  assert.deepEqual(waits, [2400])
})

test('video viewing counts playback rather than buffering time', async () => {
  const session = new BrowseSession()
  let ticks = 0
  session.wait = async () => { ticks++ }
  const video = { evaluate: async () => ticks === 0 ? 0 : ({
    time: Math.max(0, ticks - 2) * 0.25, paused: ticks <= 2, ended: false,
  }) } as unknown as Locator
  assert.equal(await viewVideo(video, 500, session), true)
  assert.equal(ticks, 4)
})

function likeTarget(alreadyLiked: boolean, confirms: boolean, y = 100) {
  let liked = alreadyLiked
  let clicks = 0
  const unlike = { count: async () => Number(liked), first: () => ({ waitFor: async () => {} }) }
  const button = {
    boundingBox: async () => ({ x: 100, y, width: 30, height: 30 }),
    page: () => ({ viewportSize: () => ({ width: 1280, height: 800 }) }),
    isVisible: async () => true,
    click: async () => { clicks++; liked = confirms },
  }
  const target = { locator: (s: string) => s.includes('Unlike') ? unlike : ({ count: async () => 1, nth: () => button }) } as unknown as Locator
  return { target, clicks: () => clicks }
}

test('likes are confirmed, and already-liked posts are untouched', async () => {
  const existing = likeTarget(true, true)
  assert.equal(await likeVisible(existing.target), false)
  assert.equal(existing.clicks(), 0)
  const success = likeTarget(false, true)
  assert.equal(await likeVisible(success.target), true)
  assert.equal(success.clicks(), 1)
  const failed = likeTarget(false, false)
  assert.equal(await likeVisible(failed.target), false)
  assert.equal(failed.clicks(), 1)
})

test('visible-in-DOM but offscreen controls are not clicked', async () => {
  const offscreen = likeTarget(false, true, 900)
  assert.equal(await clickVisible(offscreen.target, 'button'), false)
  assert.equal(offscreen.clicks(), 0)
})
