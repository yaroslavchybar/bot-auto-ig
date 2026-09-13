import { expect, test } from 'vitest'

import { api, internal } from '../../convex/_generated/api'
import { createConvexTest } from './helpers'

test('scrape job create validates posts and normalizes config', async () => {
  const t = createConvexTest()

  await expect(
    t.mutation(api.scrapeJobs.create, { name: '  ', targets: ['B1LbfVPlwIA'] }),
  ).rejects.toThrowError(/name is required/)

  await expect(
    t.mutation(api.scrapeJobs.create, { name: 'Job', targets: [] }),
  ).rejects.toThrowError(/at least one post/)

  await expect(
    t.mutation(api.scrapeJobs.create, { name: 'Job', targets: ['not a post!!'] }),
  ).rejects.toThrowError(/invalid post link/)

  const job = await t.mutation(api.scrapeJobs.create, {
    name: 'Job A',
    targets: 'https://www.instagram.com/p/B1LbfVPlwIA/\nB1LbfVPlwIA\n2110901750722920960',
    config: { maxToScrape: 50, skip: { verified: true } },
  })
  expect(job!.targets).toEqual([
    'https://www.instagram.com/p/B1LbfVPlwIA/',
    'B1LbfVPlwIA',
    '2110901750722920960',
  ])
  expect(job!.config.maxToScrape).toBe(50)
  expect(job!.config.skip).toEqual({ private: false, verified: true, noFullName: false })
  expect(job!.config.fields).toEqual({ fullName: true, isVerified: true, isPrivate: true })
  expect(job!.status).toBe('idle')
})

test('running jobs reject updates and deletes until finished', async () => {
  const t = createConvexTest()
  const job = await t.mutation(api.scrapeJobs.create, { name: 'Job B', targets: ['B1LbfVPlwIA'] })

  await t.mutation(internal.scrapeJobs.startInternal, { id: job!._id })
  await expect(
    t.mutation(api.scrapeJobs.update, { id: job!._id, name: 'Renamed' }),
  ).rejects.toThrowError(/running/)
  await expect(
    t.mutation(api.scrapeJobs.remove, { id: job!._id }),
  ).rejects.toThrowError(/running/)

  const finished = await t.mutation(internal.scrapeJobs.finishInternal, {
    id: job!._id,
    status: 'completed',
    stats: { scraped: 3 },
  })
  expect(finished!.status).toBe('completed')
  expect(finished!.stats).toMatchObject({ scraped: 3, deduped: 0 })

  const renamed = await t.mutation(api.scrapeJobs.update, { id: job!._id, name: 'Renamed' })
  expect(renamed!.name).toBe('Renamed')
})

test('insertMany dedupes scraped accounts without touching existing rows', async () => {
  const t = createConvexTest()
  const job = await t.mutation(api.scrapeJobs.create, { name: 'Job C', targets: ['B1LbfVPlwIA'] })

  await t.mutation(internal.instagramAccounts.insert, {
    userName: 'taken',
    status: 'assigned',
    message: false,
    createdAt: Date.now(),
  })

  const result = await t.mutation(internal.instagramAccounts.insertMany, {
    accounts: [
      { userName: 'fresh', fullName: 'Fresh', isPrivate: true, sourceJobId: job!._id },
      { userName: 'TAKEN' },
      { userName: '' },
    ],
  })
  expect(result).toMatchObject({ inserted: 1, existed: 1, skipped: 1 })

  const byJob = await t.query(api.instagramAccounts.listByJob, { jobId: job!._id })
  expect(byJob.map((row) => row.userName)).toEqual(['fresh'])
  expect(byJob[0]).toMatchObject({ fullName: 'Fresh', isPrivate: true, status: 'available' })
})

test('reconcile marks server-restarted runs as failed', async () => {
  const t = createConvexTest()
  const job = await t.mutation(api.scrapeJobs.create, { name: 'Job D', targets: ['B1LbfVPlwIA'] })

  await t.mutation(internal.scrapeJobs.startInternal, { id: job!._id })
  const result = await t.mutation(internal.scrapeJobs.reconcileInterruptedInternal, {})

  expect(result).toMatchObject({ reconciled: 1 })
  const after = await t.query(api.scrapeJobs.get, { id: job!._id })
  expect(after!.status).toBe('failed')
  expect(after!.error).toMatch(/restarted/)
})
