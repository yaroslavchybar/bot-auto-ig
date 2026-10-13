import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errors, type Page } from 'playwright-core'
import { visibleActionGeometry } from './action-locator.test-support.js'
import { openProfileThroughSearch, openTopicResults, publicProfileForSearch } from './explore.js'
import { BrowseSession, SessionEnded } from './session.js'

function fixture(options: { missing?: boolean; wrongTarget?: boolean; checkpoint?: boolean } = {}) {
  let url = 'https://www.instagram.com/', query = ''
  const calls: string[] = []
  const control = (name: string) => ({ ...visibleActionGeometry,
    filter() { return this }, first() { return this }, isVisible: async () => true,
    waitFor: async () => { if (name === 'result' && options.missing) throw new errors.TimeoutError('Missing result') },
    elementHandle: async () => ({ ...visibleActionGeometry, dispose: async () => {},
      hover: async () => { calls.push(`hover:${name}`) },
      fill: async (value: string) => { query = value; calls.push(`type:${value}`) },
      click: async () => {
        calls.push(`click:${name}`)
        if (name === 'result') url = options.wrongTarget ? 'https://www.instagram.com/alice_other/'
          : query.startsWith('#') ? 'https://www.instagram.com/explore/search/keyword/?q=%23strengthtraining'
          : 'https://www.instagram.com/alice/'
      },
    }),
  })
  const page = { url: () => url,
    goto: async () => { throw new Error('Direct URL navigation is forbidden') },
    locator: (selector: string) => {
      if (selector.includes('[role="alert"]')) return { filter: () => ({ evaluateAll: async () => null }) }
      if (selector === 'a:has(svg[aria-label="Search"])') return control('search')
      if (selector === 'main header' || selector.startsWith('main a[href*=')) return control('loaded')
      const expected = query.startsWith('#') ? 'main a[href="/explore/tags/strengthtraining/"]' : 'main a[href="/alice/"]'
      assert.equal(selector, expected, 'results must match the exact tag or username')
      return control('result')
    },
    getByRole: (role: string, options: unknown) => {
      assert.equal(role, 'textbox'); assert.deepEqual(options, { name: 'Search input', exact: true })
      return control('input')
    },
    keyboard: { press: async (key: string) => {
      assert.equal(key, 'Enter'); calls.push('enter')
      if (options.checkpoint) url = 'https://www.instagram.com/challenge/123/'
    } },
    waitForURL: async (matches: (url: URL) => boolean) => {
      if (!matches(new URL(url))) throw new errors.TimeoutError('Wrong account opened')
    },
  } as unknown as Page
  const session = new BrowseSession(Date.now() + 60_000)
  session.wait = async () => { session.check() }
  return { page, session, calls }
}

test('topic navigation types a hashtag, presses Enter, and clicks its native result', async () => {
  const s = fixture()
  assert.equal(await openTopicResults(s.page, 'strength training', s.session), true)
  assert.deepEqual(s.calls, ['hover:search', 'click:search', 'type:#strengthtraining', 'enter', 'hover:result', 'click:result'])
})

test('username search clicks the exact username and verifies the destination', async () => {
  const s = fixture()
  assert.equal(await openProfileThroughSearch(s.page, 'Alice', s.session), true)
  assert.deepEqual(s.calls, ['hover:search', 'click:search', 'type:alice', 'enter', 'hover:result', 'click:result'])
})

test('missing results allow a fallback but never click another suggestion', async () => {
  const s = fixture({ missing: true })
  assert.equal(await openProfileThroughSearch(s.page, 'alice', s.session), false)
  assert.ok(!s.calls.includes('click:result'))
})

test('a wrong account destination is rejected', async () => {
  const s = fixture({ wrongTarget: true })
  await assert.rejects(openProfileThroughSearch(s.page, 'alice', s.session), /Wrong account opened/)
})

test('checkpoint and stop conditions prevent result clicks', async () => {
  const s = fixture({ checkpoint: true })
  await assert.rejects(openTopicResults(s.page, 'strength training', s.session), /checkpoint needs attention/)
  assert.ok(!s.calls.includes('click:result'))
  const stopped = fixture()
  await assert.rejects(openProfileThroughSearch(stopped.page, 'alice', new BrowseSession(0)), SessionEnded)
  assert.deepEqual(stopped.calls, [])
})

test('public navigation requires visible posts, an unfollowed control, and no private notice', async () => {
  for (const [followable, privateNotice, posts, expected] of [
    [true, false, 3, true], [true, true, 3, false], [true, false, 0, false], [false, false, 3, false],
  ] as const) {
    const page = { locator: (selector: string) => selector.startsWith('xpath=')
      ? { filter() { return this }, first() { return this }, isVisible: async () => followable }
      : { filter: () => ({ count: async () => posts }) },
      getByText: () => ({ first: () => ({ isVisible: async () => privateNotice }) }),
    } as unknown as Page
    assert.equal(await publicProfileForSearch(page), expected)
  }
})
