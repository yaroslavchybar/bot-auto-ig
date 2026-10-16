import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errors, type Locator, type Page } from 'playwright-core'
import { visitStoryProfile } from './story-profile.js'
import { BrowseSession } from './session.js'
import { WarmupActivityBudget } from '../../shared/warmupPlan.js'

for (const mode of ['normal', 'already_paused', 'already_resumed', 'empty_budget', 'failed_visit', 'cancelled', 'autoplay_changed'] as const)
  test(`Story profile visit reads comments without Likes and resumes after mouse Back: ${mode}`, async () => {
    const previous = 'https://www.instagram.com/stories/alice/123/'
    let url = previous, paused = mode === 'already_paused', stopped = false
    const calls: string[] = []
    const budget = new WarmupActivityBudget({ profiles: mode === 'empty_budget' ? 0 : 1, likes: 1, reels: 0, stories: 0 })
    const session = new BrowseSession(Date.now() + 150_000, () => stopped)
    const header = { filter() { return this }, last() { return this }, isVisible: async () => true } as unknown as Locator
    const page = { url: () => url,
      locator: (selector: string) => { assert.ok(['div', 'a[href="/alice/"]', 'svg[aria-label="Play"]'].includes(selector)); return header },
      getByRole: (_role: string, { name }: { name: string }) => ({ name, filter() { return this }, first() { return this },
        isVisible: async () => name === 'Pause' ? !paused : paused,
        waitFor: async () => { assert.equal(paused, true) },
      }),
    } as unknown as Page
    const deps: NonNullable<Parameters<typeof visitStoryProfile>[5]> = {
      click: async (_page, target) => {
        const name = (target as unknown as { name: string }).name
        calls.push(name); paused = name === 'Pause'
        if (mode === 'autoplay_changed' && paused) url = 'https://www.instagram.com/stories/bob/456/'
      },
      visit: async (_page, target, _log, parent, back, engage) => {
        assert.equal(target, header); assert.equal(parent, session)
        assert.equal(back, undefined, 'use visitAuthorProfile default native mouse Back')
        calls.push('profile'); url = 'https://www.instagram.com/alice/'
        try {
          if (mode === 'cancelled') stopped = true
          if (mode === 'failed_visit') throw new errors.TimeoutError('Profile content unavailable')
          const article = { evaluate: async () => { assert.fail('Story profile posts must not be classified for engagement') } } as unknown as Locator
          await engage!(article, parent)
        } finally { url = previous; if (mode === 'already_resumed') paused = false; calls.push('back') }
      },
      comments: async (_page, _article, parent) => {
        assert.equal(parent, session)
        calls.push('comments')
      },
    }
    const run = () => visitStoryProfile(page, 'alice', session, () => {}, budget, deps)
    if (mode === 'failed_visit') await assert.rejects(run(), errors.TimeoutError)
    else await run()
    if (mode === 'empty_budget' || mode === 'autoplay_changed') assert.equal(calls.includes('profile'), false)
    else {
      assert.ok(calls.indexOf('back') > calls.indexOf('profile'))
      assert.equal(budget.used.profiles, 1)
    }
    if (mode === 'cancelled' || mode === 'already_resumed') assert.equal(calls.at(-1), 'back', 'do not toggle playback after cancellation or autoplay resume')
    else if (mode !== 'autoplay_changed') { assert.equal(calls.at(-1), 'Play'); assert.equal(paused, false) }
    if (mode === 'normal') assert.ok(calls.includes('comments'))
    assert.equal(budget.used.likes, 0, 'Story profile visits must never attempt Likes')
  })
