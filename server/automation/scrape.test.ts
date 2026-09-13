import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import type { DbProfileRow } from '../shared/convexClient.js'
import { applyScrapeFilters, scrapePostLikers } from './scrape.js'

// Routes Convex HTTP calls (by-job seed, insert-many persists, quota
// commits) without touching the network.
function mockConvex(seed: Array<Record<string, unknown>> = [], failInsertTimes = 0) {
  const originalFetch = globalThis.fetch
  const inserted: Array<Record<string, unknown>> = []
  const quotaAmounts: number[] = []
  let insertCalls = 0
  let quotaCalls = 0
  let failuresLeft = failInsertTimes
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const target = String(url)
    if (target.includes('by-job')) return Response.json(seed)
    if (target.includes('insert-many')) {
      if (failuresLeft > 0) {
        failuresLeft--
        throw new Error('insert failed')
      }
      const body = JSON.parse(String(init?.body ?? '{}'))
      insertCalls++
      inserted.push(...body.accounts)
      return Response.json({ inserted: body.accounts.length, existed: 0, skipped: 0 })
    }
    if (target.includes('increment-daily-scraping-used')) {
      quotaCalls++
      quotaAmounts.push(Number(JSON.parse(String(init?.body ?? '{}')).amount))
      return Response.json({})
    }
    throw new Error(`Unexpected fetch: ${target}`)
  }) as typeof fetch
  return {
    inserted,
    insertCalls: () => insertCalls,
    quotaCalls: () => quotaCalls,
    quotaAmounts,
    restore: () => {
      globalThis.fetch = originalFetch
    },
  }
}

function likerPage(users: Array<Record<string, unknown>>, cursor: string | null) {
  return {
    goto: async () => {},
    // NOTE: the mock bypasses the page.evaluate callback, so it returns
    // the resolved { users, cursor } shape directly.
    evaluate: async () => ({ users, cursor }),
  } as unknown as Page
}

function profile(): DbProfileRow {
  return { name: 'test', id: 'test', using: false, login: true, testIp: false } as DbProfileRow
}

test('liker scraping inserts filtered accounts and skips saved rows on resume', async () => {
  const convex = mockConvex()
  try {
    const navigated: string[] = []
    const page = {
      goto: async (url: string) => {
        navigated.push(url)
      },
      // NOTE: the mock bypasses the page.evaluate callback, so it returns
      // the resolved { users, cursor } shape directly.
      evaluate: async () => ({
        users: [
          { pk: '1', username: 'alice', full_name: 'Alice', is_private: false, is_verified: true },
          { pk: '2', username: 'bob', full_name: 'Bob', is_private: false, is_verified: false },
          { pk: '3', username: 'priv', full_name: 'Priv', is_private: true, is_verified: false },
        ],
        cursor: null,
      }),
    } as unknown as Page
    const state: Record<string, any> = {}
    const input = {
      page,
      profile: profile(),
      jobId: 'test',
      jobName: 'Test',
      config: {
        targets: ['https://www.instagram.com/p/B1LbfVPlwIA/', 'B-fKL9qpeab'],
        openDelaySeconds: 0,
        maxToScrape: 0,
        skip: { private: true, verified: false, noFullName: false },
        fields: { fullName: true, isVerified: true, isPrivate: true },
      },
      state,
    }
    // Interrupted mid-run, then resumed with the same state: the second run
    // refetches both posts but inserts nothing, since all rows are seen.
    await assert.rejects(
      scrapePostLikers({
        ...input,
        onProgress: () => {
          throw new Error('Interrupted')
        },
      }),
      /Interrupted/,
    )
    await scrapePostLikers({ ...input, onProgress: () => {} })
    assert.deepEqual(navigated, [
      'https://www.instagram.com/p/B1LbfVPlwIA/',
      'https://www.instagram.com/p/B1LbfVPlwIA/',
      'https://www.instagram.com/p/B-fKL9qpeab/',
    ])
    // Private account skipped, verified kept (skip.verified false).
    assert.deepEqual(
      convex.inserted.map((account) => account.userName),
      ['alice', 'bob'],
    )
    assert.equal(convex.inserted[0].isPrivate, false)
    assert.equal(state.completed, true)
    assert.equal(state.postIndex, 2)
    assert.equal(state.totals.scraped, 2)
    assert.equal(state.totals.targetsCompleted, 2)
  } finally {
    convex.restore()
  }
})

test('liker scraping pages large posts and persists in chunks of 25', async () => {
  const convex = mockConvex()
  try {
    const pageOne = Array.from({ length: 100 }, (_, index) => ({
      pk: `u${index + 1}`,
      username: `u${index + 1}`,
      full_name: `U ${index + 1}`,
      is_private: false,
      is_verified: false,
    }))
    const pageTwo = [
      ...Array.from({ length: 20 }, (_, index) => ({
        pk: `u${index + 101}`,
        username: `u${index + 101}`,
        full_name: `U ${index + 101}`,
        is_private: false,
        is_verified: false,
      })),
      { pk: 'u1', username: 'u1', full_name: 'U 1', is_private: false, is_verified: false },
    ]
    const page = {
      goto: async () => {},
      evaluate: async (_callback: unknown, args: { cursor: string | null }) =>
        args.cursor ? { users: pageTwo, cursor: null } : { users: pageOne, cursor: 'p2' },
    } as unknown as Page
    const state: Record<string, any> = {}
    await scrapePostLikers({
      page,
      profile: profile(),
      jobId: 'test',
      jobName: 'Test',
      config: {
        targets: ['B1LbfVPlwIA'],
        openDelaySeconds: 0,
        maxToScrape: 0,
        batchDelayMs: [0, 0],
      },
      state,
      onProgress: () => {},
    })
    // 100 fresh on page one, 20 fresh + 1 duplicate on page two.
    assert.equal(convex.inserted.length, 120)
    // 4 chunks of 25, then 1 chunk of 20.
    assert.equal(convex.insertCalls(), 5)
    assert.equal(convex.quotaCalls(), 2)
    assert.equal(state.totals.scraped, 120)
    assert.equal(state.totals.chunksCompleted, 5)
    assert.equal(state.totals.targetsCompleted, 1)
    assert.equal(state.completed, true)
  } finally {
    convex.restore()
  }
})

test('liker scraping seeds already-saved rows from Convex on resume', async () => {
  const convex = mockConvex([{ user_name: 'alice' }])
  try {
    const page = likerPage(
      [
        { pk: '1', username: 'alice', full_name: 'Alice', is_private: false, is_verified: false },
        { pk: '2', username: 'bob', full_name: 'Bob', is_private: false, is_verified: false },
      ],
      null,
    )
    const state: Record<string, any> = {}
    await scrapePostLikers({
      page,
      profile: profile(),
      jobId: 'test',
      jobName: 'Test',
      config: { targets: ['B1LbfVPlwIA'], openDelaySeconds: 0, batchDelayMs: [0, 0] },
      state,
      onProgress: () => {},
    })
    assert.deepEqual(
      convex.inserted.map((account) => account.userName),
      ['bob'],
    )
    assert.equal(state.totals.scraped, 1)
    assert.equal(state.totals.deduped, 1)
    assert.equal(state.completed, true)
  } finally {
    convex.restore()
  }
})

test('liker scraping errors on a repeated pagination cursor', async () => {
  const convex = mockConvex()
  try {
    const page = likerPage(
      [{ pk: 'u1', username: 'u1', full_name: 'U 1', is_private: false, is_verified: false }],
      'c1',
    )
    await assert.rejects(
      scrapePostLikers({
        page,
        profile: profile(),
        jobId: 'test',
        jobName: 'Test',
        config: { targets: ['B1LbfVPlwIA'], openDelaySeconds: 0, batchDelayMs: [0, 0] },
        state: {},
        onProgress: () => {},
      }),
      /repeated pagination cursor/,
    )
    assert.equal(convex.inserted.length, 1)
  } finally {
    convex.restore()
  }
})

test('liker scraping errors on an empty page with more results pending', async () => {
  const convex = mockConvex()
  try {
    const page = likerPage([], 'pending-cursor')
    await assert.rejects(
      scrapePostLikers({
        page,
        profile: profile(),
        jobId: 'test',
        jobName: 'Test',
        config: { targets: ['B1LbfVPlwIA'], openDelaySeconds: 0, batchDelayMs: [0, 0] },
        state: {},
        onProgress: () => {},
      }),
      /empty page with more results pending/,
    )
    assert.equal(convex.inserted.length, 0)
  } finally {
    convex.restore()
  }
})

test('maxToScrape stays per-post across resumes', async () => {
  const convex = mockConvex()
  try {
    const page = likerPage(
      [
        { pk: '1', username: 'a', full_name: 'A', is_private: false, is_verified: false },
        { pk: '2', username: 'b', full_name: 'B', is_private: false, is_verified: false },
        { pk: '3', username: 'c', full_name: 'C', is_private: false, is_verified: false },
      ],
      null,
    )
    const state: Record<string, any> = {}
    const run = () =>
      scrapePostLikers({
        page,
        profile: profile(),
        jobId: 'test',
        jobName: 'Test',
        config: { targets: ['B1LbfVPlwIA'], openDelaySeconds: 0, maxToScrape: 2, batchDelayMs: [0, 0] },
        state,
        onProgress: () => {},
      })
    await run()
    // Same state resumed: the third user is fresh but the persisted per-post
    // count already hit the cap, so nothing more is inserted.
    await run()
    assert.deepEqual(
      convex.inserted.map((account) => account.userName),
      ['a', 'b'],
    )
    assert.equal(state.totals.scraped, 2)
    assert.equal(state.completed, true)
  } finally {
    convex.restore()
  }
})

test('quota charge never exceeds the profile daily limit', async () => {
  const convex = mockConvex()
  try {
    const page = likerPage(
      [
        { pk: '1', username: 'a', full_name: 'A', is_private: false, is_verified: false },
        { pk: '2', username: 'b', full_name: 'B', is_private: false, is_verified: false },
        { pk: '3', username: 'c', full_name: 'C', is_private: false, is_verified: false },
      ],
      null,
    )
    const prof = profile()
    prof.dailyScrapingLimit = 2
    prof.dailyScrapingUsed = 0
    await scrapePostLikers({
      page,
      profile: prof,
      jobId: 'test',
      jobName: 'Test',
      config: { targets: ['B1LbfVPlwIA'], openDelaySeconds: 0, batchDelayMs: [0, 0] },
      state: {},
      onProgress: () => {},
    })
    // Page fetched 3 users but only 2 were charged; local counter matches.
    assert.deepEqual(convex.quotaAmounts, [2])
    assert.equal(prof.dailyScrapingUsed, 2)
    assert.equal(convex.inserted.length, 3)
  } finally {
    convex.restore()
  }
})

test('failed inserts retry their rows on resume instead of skipping them', async () => {
  const convex = mockConvex([], 1)
  try {
    const page = likerPage(
      [
        { pk: '1', username: 'a', full_name: 'A', is_private: false, is_verified: false },
        { pk: '2', username: 'b', full_name: 'B', is_private: false, is_verified: false },
      ],
      null,
    )
    const state: Record<string, any> = {}
    const run = () =>
      scrapePostLikers({
        page,
        profile: profile(),
        jobId: 'test',
        jobName: 'Test',
        config: { targets: ['B1LbfVPlwIA'], openDelaySeconds: 0, batchDelayMs: [0, 0] },
        state,
        onProgress: () => {},
      })
    await assert.rejects(run(), /insert failed/)
    await run()
    assert.deepEqual(
      convex.inserted.map((account) => account.userName),
      ['a', 'b'],
    )
    assert.equal(state.totals.scraped, 2)
    assert.equal(state.completed, true)
  } finally {
    convex.restore()
  }
})

test('liker scraping rejects invalid post links', async () => {
  const page = { goto: async () => {} } as unknown as Page
  const state: Record<string, any> = {}
  await assert.rejects(
    scrapePostLikers({
      page,
      profile: { name: 'test' } as DbProfileRow,
      jobId: 'test',
      jobName: 'Test',
      config: { targets: ['not a post'] },
      state,
      onProgress: () => {},
    }),
    /Invalid post link/,
  )
  await assert.rejects(
    scrapePostLikers({
      page,
      profile: { name: 'test' } as DbProfileRow,
      jobId: 'test',
      jobName: 'Test',
      config: { targets: [] },
      state: {},
      onProgress: () => {},
    }),
    /no posts/,
  )
})

test('applyScrapeFilters honors skip rules and field selection', () => {
  const users = [
    { username: 'keep', full_name: 'Keep', is_private: false, is_verified: false },
    { username: 'priv', full_name: 'Priv', is_private: true, is_verified: false },
    { username: 'verif', full_name: 'Verif', is_private: false, is_verified: true },
    { username: 'noname', full_name: '', is_private: false, is_verified: false },
    { username: '', full_name: 'Blank', is_private: false, is_verified: false },
  ]
  const all = applyScrapeFilters(users, {})
  assert.equal(all.kept.length, 4)
  assert.equal(all.skipped, 1)

  const skipped = applyScrapeFilters(users, {
    skip: { private: true, verified: true, noFullName: true },
  })
  assert.deepEqual(
    skipped.kept.map((account) => account.userName),
    ['keep'],
  )
  assert.equal(skipped.skipped, 4)

  const projected = applyScrapeFilters(users.slice(0, 1), {
    fields: { fullName: false, isVerified: false, isPrivate: false },
  })
  assert.deepEqual(projected.kept, [{ userName: 'keep', fullName: undefined, isVerified: undefined, isPrivate: undefined }])
})
