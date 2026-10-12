import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { Window } from 'happy-dom'
import { WarmupActivityBudget } from '../../shared/warmupPlan.js'
import { watchReels } from './reels.js'
import { BrowseSession } from './session.js'

test('disabled reels never access the browser', async () => {
  await watchReels({} as Page, 5, { scroll_reels: false }, () => {}, () => false, Date.now() + 60_000)
})

for (const followed of [false, true]) test(followed
  ? 'followed off-topic reels are watched even with a 100% random skip chance'
  : 'reels stay passive even with previously active settings and unused like allowance', async () => {
  const window = new Window(), originalNow = Date.now
  let now = originalNow()
  const start = now
  Date.now = () => now
  try {
    window.document.body.innerHTML = `<main><div><div><a href="/author/reels/">author</a>${followed ? '' : '<button>Follow</button>'}</div>
      <video></video><p>${followed ? 'Cooking dinner' : 'Barbell squats and progressive overload'}</p></div></main>`
    for (const control of window.document.querySelectorAll('button'))
      Object.defineProperty(control, 'getBoundingClientRect', { value: () => ({ width: 50, height: 20 }) })
    const video = window.document.querySelector('video')!
    Object.defineProperties(video, {
      duration: { value: 0 }, currentTime: { get: () => (now - start) / 1000 },
      paused: { value: false }, ended: { value: false },
    })
    const target = {
      boundingBox: async () => ({ x: 200, y: 0, width: 500, height: 600 }),
      evaluate: async (fn: (element: Element) => unknown) => fn(video as unknown as Element),
    }
    const videos = { count: async () => 1, nth: () => target }
    const page = { url: () => 'https://www.instagram.com/reels/current/',
      viewportSize: () => ({ width: 1280, height: 800 }), evaluate: async () => false,
      locator: (selector: string) => {
        if (selector === 'video') return videos
        assert.equal(selector, '[role="dialog"], [role="alertdialog"], [role="alert"]')
        return { filter: () => ({ evaluateAll: async () => null }) }
      },
    } as unknown as Page
    const session = new BrowseSession(now + 60_000)
    session.wait = async ms => { now += Math.max(1, Math.ceil(ms)); session.check() }
    const budget = new WarmupActivityBudget({ likes: 6, profiles: 2, reels: 1, stories: 0 })
    let decisions = 0
    await watchReels(page, 1, { soft_warmup: false, warmup_topics: 'fitness', like_chance: 100, reels_skip_chance: followed ? 100 : 0 },
      () => {}, () => false, session.end, session, budget, async context => {
        decisions++
        assert.match(context.text, /Barbell squats/)
        return true
      })
    assert.equal(decisions, followed ? 0 : 1)
    assert.equal(budget.used.likes, 0)
    assert.equal(budget.used.reels, 1)
    assert.ok(now - start >= 6000)
  } finally { Date.now = originalNow; await window.happyDOM.close() }
})
