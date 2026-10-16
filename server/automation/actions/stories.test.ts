import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errors, type Page } from 'playwright-core'
import { hasUnseenStories, watchStories, storyProgress, UNSEEN_STORY_SELECTOR } from './stories.js'
import { BrowseSession } from './session.js'
import { Window } from 'happy-dom'
import { visibleActionGeometry } from './action-locator.test-support.js'
import { WarmupActivityBudget } from '../../shared/warmupPlan.js'

test('startup detects only a visible unseen Story, using a short wait within the session deadline', async () => {
  for (const available of [true, false]) {
    const page = { locator: (selector: string) => {
      assert.equal(selector, `${UNSEEN_STORY_SELECTOR}:visible`)
      return { first() { return this }, waitFor: async ({ state, timeout }: { state: string; timeout: number }) => {
        assert.equal(state, 'visible')
        assert.ok(timeout > 0 && timeout <= 1000)
        if (!available) throw new errors.TimeoutError('No unseen Story')
      } }
    } } as unknown as Page
    assert.equal(await hasUnseenStories(page, new BrowseSession(Date.now() + 1000)), available)
  }
})

test('startup Story detection respects cancellation and propagates browser failures', async () => {
  const page = { locator: () => { throw new Error('Browser disconnected') } } as unknown as Page
  await assert.rejects(hasUnseenStories(page, new BrowseSession(Infinity, () => true)), /session ended/)
  await assert.rejects(hasUnseenStories(page, new BrowseSession()), /Browser disconnected/)
})


async function fixture(options: { missing?: boolean; budgetMs?: number; hardMs?: number; autoplay?: boolean;
  seenNext?: boolean; stopDuringView?: boolean; paused?: boolean; sameOwner?: boolean; nextError?: boolean; stalled?: boolean;
  closesDuringCleanup?: boolean; stalledFirst?: boolean; profileVisits?: boolean; profileChance?: boolean;
  stopDuringCloseCheck?: boolean; primaryError?: Error; cleanupError?: Error; notes?: Record<string, unknown>[] } = {}) {
  const originalNow = Date.now
  let now = originalNow(), opened = false, stopped = false, nextClicks = 0, closed = 0, index = 0, plays = 0
  let elapsed = 0, paused = options.paused ?? false
  const start = now, budgetMs = options.budgetMs ?? 5000
  const frames = [{ owner: 'alice', segment: 0 }, { owner: options.seenNext ? 'seen' : options.sameOwner ? 'alice' : 'bob', segment: options.sameOwner ? 1 : 0 }]
  const owners = ['alice', 'bob']
  const visits: string[] = [], rolls: number[] = []
  const budget = new WarmupActivityBudget({ profiles: options.profileVisits ? 3 : 0, likes: 2, stories: 0, reels: 0 })
  Date.now = () => now
  const story = { ...visibleActionGeometry, first() { return this }, evaluateAll: async () => owners,
    isVisible: async () => !options.missing,
    waitFor: async () => { if (options.missing) throw new errors.TimeoutError('No unseen stories') },
    elementHandle: async () => ({ ...visibleActionGeometry, hover: async () => {},
      click: async () => { opened = true }, dispose: async () => {} }),
  }
  const page = { viewportSize: () => ({ width: 1280, height: 800 }),
    url: () => opened ? 'https://www.instagram.com/stories/' + frames[index]!.owner + '/' : 'https://www.instagram.com/',
    waitForURL: async (accept: (url: URL) => boolean) => { if (!accept(new URL(page.url()))) throw new errors.TimeoutError('Story did not advance') },
    keyboard: { press: async (key: string) => { assert.equal(opened, false, 'never close the story with Escape'); assert.equal(key, 'Escape') } },
    locator: (selector: string) => selector.includes('Story by') ? story : { count: async () => 0, filter: () => ({ evaluateAll: async () => null }) },
    getByRole: (_role: string, controlOptions: { name: string }) => ({ name: controlOptions.name, filter() { return this }, first() { return this },
      isVisible: async () => {
        if (controlOptions.name === 'Close' && options.stopDuringCloseCheck) stopped = true
        return controlOptions.name === 'Close' ? opened : controlOptions.name === 'Play' ? paused : controlOptions.name === 'Next' && index < frames.length - 1
      },
    }),
  } as unknown as Page
  const advance = () => { index++; elapsed = 0; if (index >= frames.length) { index--; opened = false } }
  const deps: NonNullable<Parameters<typeof watchStories>[5]> = {
    progress: async () => {
      if (options.primaryError) throw options.primaryError
      return opened ? { index: frames[index]!.segment, total: options.sameOwner ? 2 : 1, progress: Math.min(1, elapsed / 600) } : null
    },
    click: async (_page, target, session) => {
      session.check()
      const name = (target as unknown as { name: string }).name
      if (name === 'Close') {
        if (options.cleanupError) throw options.cleanupError
        closed++; opened = false
        if (options.closesDuringCleanup) throw new errors.TimeoutError('Instagram already removed Close')
      }
      else if (name === 'Play') { plays++; paused = false }
      else {
        assert.equal(name, 'Next'); assert.ok(elapsed >= 600 || options.stalledFirst && index === 0 && now - start >= 90_000,
          'only completed or timed-out stories receive Next')
        if (options.nextError) throw new errors.TimeoutError('Next moved')
        nextClicks++; advance()
      }
    },
    wait: async (session, ms) => {
      session.check(); now += Math.max(1, Math.ceil(ms))
      if (!paused && !options.stalled && !(options.stalledFirst && index === 0)) elapsed += ms
      if (options.stopDuringView) stopped = true
      if (options.autoplay && elapsed >= 600) advance()
      session.check()
    },
    chance: percent => { rolls.push(Number(percent)); return options.profileChance ?? true },
    visit: async (_page, owner, parent, _log, shared) => {
      assert.equal(shared, budget); assert.ok(parent.end - now >= 45_000)
      visits.push(owner); shared.take('profiles'); now += 95_000
    },
  }
  try {
    const notes: Record<string, unknown>[] = options.notes ?? []
    const watched = await watchStories(page, Infinity, note => notes.push(note), () => stopped, {
      deadline: start + budgetMs, sessionDeadline: start + (options.hardMs ?? 20_000),
      budget,
    }, deps)
    return { watched, nextClicks, closed, opened, plays, notes, visits, rolls, elapsed: now - start }
  } finally { Date.now = originalNow }
}

test('progress comes from the active segment, excluding hidden previews and non-progress transforms', async () => {
  const window = new Window({ width: 1280, height: 800 })
  try {
    window.document.body.innerHTML = '<div style="transform:translateX(-16px)"></div>' +
      '<div><div><div style="transform:translateX(0%)"></div></div></div>' +
      '<div id="row"><div></div><div id="track"><div id="fill" style="transform:translateX(-35%)"></div></div><div></div></div>'
    const track = window.document.querySelector('#track')!, fill = window.document.querySelector('#fill')!
    track.getBoundingClientRect = () => ({ width: 100, height: 2, top: 30, bottom: 32, left: 300, right: 400 }) as DOMRect
    const nodes = [...window.document.querySelectorAll('div[style]')] as unknown as Element[]
    assert.deepEqual(storyProgress(nodes), { index: 1, total: 3, progress: 0.65 })
    fill.setAttribute('style', 'transform:translateX(0%)')
    assert.equal(storyProgress(nodes)?.progress, 1)
    fill.setAttribute('style', 'transform:translateX(-100%)')
    assert.equal(storyProgress(nodes)?.progress, 0)
    track.getBoundingClientRect = () => ({ width: 100, height: 2, top: -20, bottom: -18, left: 300, right: 400 }) as DOMRect
    assert.equal(storyProgress(nodes), null)
  } finally { await window.happyDOM.close() }
})

test('no unseen stories returns immediately without opening or spending the viewing window', async () => {
  const result = await fixture({ missing: true, budgetMs: 180_000 })
  assert.equal(result.watched, 0); assert.equal(result.opened, false); assert.equal(result.elapsed, 0)
})

test('manual Next is used only after progress completes and the viewer closes through X', async () => {
  const result = await fixture()
  assert.equal(result.watched, 2); assert.equal(result.nextClicks, 1); assert.equal(result.closed, 1)
  assert.ok(result.elapsed >= 1200)
})

test('autoplay, including same-owner segments with an unchanged URL, never receives an extra Next click', async () => {
  for (const sameOwner of [false, true]) {
    const result = await fixture({ autoplay: true, sameOwner })
    assert.equal(result.watched, 2); assert.equal(result.nextClicks, 0)
    assert.equal(result.elapsed, 1200); assert.equal(result.closed, 0, 'Instagram closed the last completed story itself')
  }
})

test('the viewing window stops new stories but finishes the current one', async () => {
  const result = await fixture({ budgetMs: 250 })
  assert.equal(result.watched, 1); assert.equal(result.elapsed, 600); assert.equal(result.nextClicks, 0); assert.equal(result.closed, 1)
})

test('expiry during the autoplay grace period does not start another story', async () => {
  const result = await fixture({ budgetMs: 700 })
  assert.equal(result.watched, 1); assert.equal(result.nextClicks, 0); assert.equal(result.closed, 1)
})

test('Instagram removing the viewer during cleanup does not fail further browsing', async () => {
  const result = await fixture({ budgetMs: 250, closesDuringCleanup: true })
  assert.equal(result.watched, 1); assert.equal(result.closed, 1)
})

test('the hard session deadline still stops an unfinished story and closes through X', async () => {
  const result = await fixture({ budgetMs: 250, hardMs: 400 })
  assert.equal(result.watched, 0); assert.equal(result.elapsed, 400); assert.equal(result.closed, 1)
})

test('a paused story resumes through Play before waiting for progress completion', async () => {
  const result = await fixture({ paused: true, budgetMs: 250 })
  assert.equal(result.plays, 1); assert.equal(result.watched, 1); assert.equal(result.elapsed, 600)
})

test('an already-seen account receives no viewing time after autoplay reaches it', async () => {
  const result = await fixture({ autoplay: true, seenNext: true })
  assert.equal(result.watched, 1); assert.equal(result.elapsed, 600); assert.equal(result.closed, 1)
})

test('a stop during playback prevents cleanup input and does not count the unfinished story', async () => {
  const result = await fixture({ stopDuringView: true })
  assert.equal(result.watched, 0); assert.equal(result.closed, 0); assert.equal(result.opened, true)
})

test('a stop while checking the Close button prevents its click', async () => {
  const result = await fixture({ budgetMs: 250, stopDuringCloseCheck: true })
  assert.equal(result.watched, 1); assert.equal(result.closed, 0); assert.equal(result.opened, true)
  assert.equal(result.notes.some(note => note.event === 'automation.actions.stories.cleanup_failed'), false)
})

test('cleanup failures are logged and cannot replace the original operation error', async () => {
  const primaryError = new Error('Primary browser failure'), cleanupError = new Error('Close failed')
  const notes: Record<string, unknown>[] = []
  await assert.rejects(fixture({ primaryError, cleanupError, notes }), error => error === primaryError)
  assert.ok(notes.some(note => note.event === 'automation.actions.stories.cleanup_failed' && note.error === cleanupError))
})

test('a cleanup failure after normal viewing is logged without failing optional Stories', async () => {
  const cleanupError = new errors.TimeoutError('Close unavailable')
  const result = await fixture({ budgetMs: 250, cleanupError })
  assert.equal(result.watched, 1)
  assert.ok(result.notes.some(note => note.event === 'automation.actions.stories.cleanup_failed' && note.error === cleanupError))
})

test('a temporary Next failure closes through X and leaves further browsing available', async () => {
  const result = await fixture({ nextError: true })
  assert.equal(result.watched, 1); assert.equal(result.closed, 1)
  assert.ok(result.notes.some(note => note.event === 'automation.actions.stories.skipped'))
})

test('stalled playback does not fabricate a completed view or press Next', async () => {
  const result = await fixture({ stalled: true, hardMs: 1000 })
  assert.equal(result.watched, 0); assert.equal(result.nextClicks, 0); assert.equal(result.closed, 1)
})

test('a per-story timeout skips the stalled clip, continues to the next and counts only its completed view', async () => {
  const result = await fixture({ stalledFirst: true, budgetMs: 120_000, hardMs: 150_000 })
  assert.equal(result.watched, 1); assert.equal(result.nextClicks, 1); assert.equal(result.closed, 1)
  assert.ok(result.notes.some(note => note.reason === 'playback_stalled'))
})

test('profile visits roll once per owner and do not consume the Story playback timeout', async () => {
  const result = await fixture({ profileVisits: true, sameOwner: true, budgetMs: 250_000, hardMs: 300_000 })
  assert.deepEqual(result.visits, ['alice']); assert.deepEqual(result.rolls, [15])
  assert.equal(result.watched, 2)
  assert.equal(result.notes.some(note => note.reason === 'playback_stalled'), false)
})

test('declined random profile visits do not roll again on the same owner or consume viewing time', async () => {
  const result = await fixture({ profileVisits: true, profileChance: false, sameOwner: true, budgetMs: 100_000, hardMs: 150_000 })
  assert.deepEqual(result.visits, []); assert.deepEqual(result.rolls, [15]); assert.equal(result.watched, 2)
})
