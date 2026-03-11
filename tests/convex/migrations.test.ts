import { expect, test } from 'vitest'

import { internal } from '../../convex/_generated/api'
import { createConvexTest, insertDoc } from './helpers'

test('cleans scraper-auto-only task runtime state and resets running tasks', async () => {
  const t = createConvexTest()
  const task = await insertDoc(t, 'scrapingTasks', {
    name: 'Task A',
    kind: 'followers',
    targetUsername: 'target-a',
    targets: ['target-a'],
    imported: false,
    status: 'running',
    currentTargetIndex: 0,
    attempt: 0,
    maxAttempts: 8,
    stats: {
      scraped: 0,
      deduped: 0,
      chunksCompleted: 0,
      targetsCompleted: 0,
    },
    chunkRefs: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastOutput: {
      mode: 'legacy',
      resumeState: { mode: 'legacy' },
      kept: true,
    },
  })

  const taskCleanup = await t.mutation(internal.migrations.scraperAutoOnlyApplyTaskCleanup, {
    taskId: task!._id,
  })
  const cleanedTask = await t.run(async (ctx) => ctx.db.get(task!._id))

  expect(taskCleanup).toMatchObject({
    updated: true,
    removedLegacyFields: 0,
    resetToIdle: true,
    clearedRuntimeState: true,
  })
  expect(cleanedTask).toMatchObject({
    status: 'idle',
    lastOutput: {
      kept: true,
    },
  })
})
