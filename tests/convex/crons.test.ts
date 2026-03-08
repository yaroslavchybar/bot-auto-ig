import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { internal } from '../../convex/_generated/api'
import { createConvexTest, insertDoc } from './helpers'

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.doUnmock('convex/server')
  vi.doUnmock('../../convex/_generated/api')
  vi.resetModules()
})

test('registers the expected daily cron jobs', async () => {
  const daily = vi.fn()

  vi.doMock('convex/server', async () => {
    const actual = await vi.importActual<typeof import('convex/server')>('convex/server')
    return {
      ...actual,
      cronJobs: () => ({ daily }),
    }
  })
  vi.doMock('../../convex/_generated/api', async () => {
    const actual = await vi.importActual<typeof import('../../convex/_generated/api')>('../../convex/_generated/api')
    return {
      ...actual,
      internal: {
        profiles: { resetDailyScrapingUsed: 'profiles.resetDailyScrapingUsed' },
        instagramAccounts: {
          autoUnsubscribe: 'instagramAccounts.autoUnsubscribe',
          assignAvailableAccountsDaily: 'instagramAccounts.assignAvailableAccountsDaily',
        },
        workflows: { resetDailyRuns: 'workflows.resetDailyRuns' },
      },
    }
  })

  await import('../../convex/crons')

  expect(daily.mock.calls).toEqual([
    ['reset daily scraping', { hourUTC: 0, minuteUTC: 1 }, 'profiles.resetDailyScrapingUsed'],
    ['auto unsubscribe', { hourUTC: 3, minuteUTC: 0 }, 'instagramAccounts.autoUnsubscribe'],
    ['assign accounts', { hourUTC: 3, minuteUTC: 15 }, 'instagramAccounts.assignAvailableAccountsDaily'],
    ['reset workflow daily runs', { hourUTC: 0, minuteUTC: 2 }, 'workflows.resetDailyRuns'],
  ])
})

describe('cron targets', () => {
  test('resets daily scraping usage for profiles', async () => {
    const t = createConvexTest()
    const profile = await insertDoc(t, 'profiles', {
      createdAt: Date.now(),
      name: 'Profile A',
      using: false,
      testIp: false,
      login: true,
      mode: 'direct',
      listIds: [],
      dailyScrapingUsed: 12,
    })

    await t.mutation(internal.profiles.resetDailyScrapingUsed, {})

    const updated = await t.run(async (ctx) => ctx.db.get(profile!._id))
    expect(updated?.dailyScrapingUsed).toBe(0)
  })

  test('auto-unsubscribes stale subscribed accounts', async () => {
    const t = createConvexTest()
    const account = await insertDoc(t, 'instagramAccounts', {
      userName: 'user-a',
      createdAt: Date.now(),
      status: 'subscribed',
      message: false,
      subscribedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
    })

    await t.action(internal.instagramAccounts.autoUnsubscribe, {})

    const updated = await t.run(async (ctx) => ctx.db.get(account!._id))
    expect(updated?.status).toBe('unsubscribed')
  })

  test('resets daily workflow run counters', async () => {
    const t = createConvexTest()
    const workflow = await insertDoc(t, 'workflows', {
      name: 'Workflow A',
      description: 'cron target',
      nodes: [],
      edges: [],
      listIds: [],
      status: 'idle',
      isActive: true,
      runsToday: 4,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    const result = await t.mutation(internal.workflows.resetDailyRuns, {})
    const updated = await t.run(async (ctx) => ctx.db.get(workflow!._id))

    expect(result).toEqual({ reset: 1 })
    expect(updated?.runsToday).toBe(0)
  })
})
