import { expect, test } from 'vitest'

import { api } from '../../convex/_generated/api'
import { createConvexTest } from './helpers'

test('creates tasks, stores scraped data, and exposes storage urls', async () => {
  const t = createConvexTest()
  const task = await t.mutation(api.scrapingTasks.create, {
    name: 'Task A',
    kind: 'followers',
    targetUsername: 'target-a',
  })

  const stored = await t.action(api.scrapingTasks.storeScrapedData, {
    taskId: task!._id,
    users: [{ userName: 'user-a' }],
    metadata: { source: 'test' },
  })
  await t.mutation(api.scrapingTasks.setStatus, {
    id: task!._id,
    status: 'completed',
    lastRunAt: Date.now(),
    storageId: stored.storageId,
  })

  const updated = await t.query(api.scrapingTasks.getById, { id: task!._id })
  const url = await t.query(api.scrapingTasks.getStorageUrl, {
    storageId: stored.storageId,
  })
  const unimported = await t.query(api.scrapingTasks.listUnimported, {
    kind: 'followers',
  })

  expect(stored.count).toBe(1)
  expect(updated?.storageId).toBe(stored.storageId)
  expect(typeof url).toBe('string')
  expect(unimported).toHaveLength(1)
})

test('normalizes task status updates', async () => {
  const t = createConvexTest()
  const task = await t.mutation(api.scrapingTasks.create, {
    name: 'Task B',
    kind: 'followers',
    targetUsername: 'target-b',
  })

  const updated = await t.mutation(api.scrapingTasks.setStatus, {
    id: task!._id,
    status: 'RUNNING',
    lastError: ' failed ',
  })

  expect(updated).toMatchObject({
    status: 'running',
    lastError: 'failed',
  })
})
