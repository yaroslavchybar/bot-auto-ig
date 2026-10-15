import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Locator, Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { reelAdMarker, waitForReelOutreach } from './reels.js'
import { BrowseSession, SessionEnded } from './session.js'

function fixture(items: Array<'ad' | 'weak' | 'strong'>) {
  let now = Date.now(), index = 0, stopped = false, path = '/reels/0/'
  const start = now, until = start + 10_000, holds: number[] = [], classified: number[] = [], advanced: number[] = []
  const parent = new BrowseSession(start + 60_000, () => stopped)
  parent.wait = async ms => { parent.check(); assert.ok(ms >= 0); holds.push(index); now += ms; parent.check() }
  const page = { url: () => 'https://www.instagram.com' + path } as Page
  const post = {} as Locator
  const video = { locator: () => post, evaluate: async (fn: unknown) => fn === reelAdMarker
    ? items[index] === 'ad' ? 'ad_redirect' : null : { text: 'Caption', relationship: 'not-followed' },
  } as unknown as Locator
  const deps: NonNullable<Parameters<typeof waitForReelOutreach>[5]> = {
    now: () => now, check: async () => {}, video: async () => video,
    matches: async () => { classified.push(index); return items[index] === 'strong' },
    advance: async () => { advanced.push(index); index++; path = `/reels/${index}/`; now += 250; return true },
  }
  const run = (topics: string[] = ['Fishing']) => waitForReelOutreach(page, until, { warmup_topics: topics }, parent, () => {}, deps)
  return { run, deps, parent, video, until, holds, advanced, classified, now: () => now,
    advanceTime: (ms: number) => { now += ms }, navigate: (to: string) => { path = to }, stop: () => { stopped = true } }
}

test('outreach skips ads and weak Reels, and waits only on a strong match', async () => {
  const s = fixture(['ad', 'weak', 'strong'])
  assert.equal(await s.run(), true)
  assert.deepEqual(s.advanced, [0, 1])
  assert.deepEqual(s.classified, [1, 2], 'never send an ad to Luna')
  assert.ok(s.holds.length > 0 && s.holds.every(index => index === 2))
  assert.equal(s.now(), s.until)
})

for (const topics of [[], [' ', '']]) test(`empty interests preserve the non-ad pause (${JSON.stringify(topics)})`, async () => {
  const s = fixture(['weak'])
  assert.equal(await s.run(topics), true)
  assert.equal(s.now(), s.until)
  assert.deepEqual(s.classified, [])
  assert.deepEqual(s.advanced, [])
  assert.ok(s.holds.length > 1 && s.holds.every(index => index === 0))
})

test('empty interests still skip an initial ad before lingering on the next non-ad Reel', async () => {
  const s = fixture(['ad', 'weak'])
  await s.run([])
  assert.deepEqual(s.advanced, [0]); assert.deepEqual(s.classified, [])
  assert.ok(s.holds.length > 0 && s.holds.every(index => index === 1))
  assert.equal(s.now(), s.until)
})

test('empty interests keep checking for ad labels throughout the pause', async () => {
  const s = fixture(['weak', 'weak']), evaluate = s.video.evaluate.bind(s.video)
  let probes = 0
  s.video.evaluate = (async (fn: unknown) => {
    if (fn === reelAdMarker && ++probes === 3) return 'ad_redirect'
    return evaluate(fn as never)
  }) as typeof s.video.evaluate
  await s.run([])
  assert.deepEqual(s.advanced, [0]); assert.deepEqual(s.classified, [])
  assert.ok(s.holds.includes(0) && s.holds.includes(1))
  assert.equal(s.now(), s.until)
})

for (const failureAt of [1, 2]) test(`empty-interest lingering is cleared on a temporary ad-probe error (${failureAt})`, async () => {
  const s = fixture(['weak', 'weak']), evaluate = s.video.evaluate.bind(s.video)
  let probes = 0
  s.video.evaluate = (async (fn: unknown) => {
    if (fn === reelAdMarker && ++probes === failureAt) throw new errors.TimeoutError('DOM changed')
    return evaluate(fn as never)
  }) as typeof s.video.evaluate
  await s.run([])
  assert.deepEqual(s.advanced, [0]); assert.deepEqual(s.classified, [])
  assert.ok(s.holds.length > 0 && s.holds.every(index => index === 1))
})

test('a classification timeout still skips the rejected Reel at the pause boundary', async () => {
  const s = fixture(['weak', 'ad'])
  s.deps.matches = async () => { s.advanceTime(10_000); throw new SessionEnded('Pause ended') }
  assert.equal(await s.run(), true)
  assert.deepEqual(s.advanced, [0])
  assert.deepEqual(s.holds, [])
})

test('a failed advance ends the pause immediately rather than camping on an ad', async () => {
  const s = fixture(['ad'])
  s.deps.advance = async () => false
  assert.equal(await s.run(), false)
  assert.deepEqual(s.holds, [])
  assert.ok(s.now() < s.until)
})

test('an ad label that loads during the pause is detected and skipped', async () => {
  const s = fixture(['strong', 'strong'])
  const evaluate = s.video.evaluate.bind(s.video)
  let probes = 0
  s.video.evaluate = (async (fn: unknown) => {
    if (fn === reelAdMarker && ++probes === 3) return 'ad_redirect'
    return evaluate(fn as never)
  }) as typeof s.video.evaluate
  await s.run()
  assert.deepEqual(s.advanced, [0])
  assert.ok(s.holds.includes(1))
})

test('a temporary ad-probe failure skips instead of holding unknown content', async () => {
  const s = fixture(['strong', 'strong'])
  const evaluate = s.video.evaluate.bind(s.video)
  let probes = 0
  s.video.evaluate = (async (fn: unknown) => {
    if (fn === reelAdMarker && ++probes === 2) throw new errors.TimeoutError('DOM changed')
    return evaluate(fn as never)
  }) as typeof s.video.evaluate
  await s.run(); assert.deepEqual(s.advanced, [0]); assert.ok(s.holds.every(i => i === 1))
})

test('a late decision does not hold or advance a newly navigated Reel', async () => {
  const s = fixture(['strong'])
  let calls = 0
  s.deps.matches = async () => {
    if (++calls === 1) { s.navigate('/reels/changed/'); return false }
    return true
  }
  await s.run(); assert.deepEqual(s.advanced, []); assert.equal(calls, 2)
})

test('non-Reels retain their normal transition wait without browser probes', async () => {
  const s = fixture(['weak'])
  s.navigate('/alice/')
  s.deps.video = async () => { throw new Error('Must not inspect a profile as a Reel') }
  await s.run(); assert.equal(s.now(), s.until); assert.deepEqual(s.advanced, [])
})

test('cancellation during classification prevents both waiting and scrolling', async () => {
  const s = fixture(['weak'])
  s.deps.matches = async () => { s.stop(); throw new SessionEnded('Stopped') }
  await assert.rejects(s.run(), SessionEnded)
  assert.deepEqual(s.advanced, []); assert.deepEqual(s.holds, [])
})

test('account warnings still propagate before an outreach pause', async () => {
  const s = fixture(['strong'])
  s.deps.check = async () => { throw new Error('Instagram checkpoint needs attention') }
  await assert.rejects(s.run(), /checkpoint/)
  assert.deepEqual(s.advanced, []); assert.deepEqual(s.holds, [])
})
