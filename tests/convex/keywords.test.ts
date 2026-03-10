import { expect, test } from 'vitest'

import { internal } from '../../convex/_generated/api'
import { createConvexTest } from './helpers'

test('upserts, lists, reads, and removes keyword files', async () => {
  const t = createConvexTest()

  const created = await t.mutation(internal.keywords.upsert, {
    filename: 'names.txt',
    content: 'Alice\nBob',
  })
  const list = await t.query(internal.keywords.list, {})
  const content = await t.query(internal.keywords.get, { filename: 'names.txt' })
  const removed = await t.mutation(internal.keywords.remove, { filename: 'names.txt' })
  const missing = await t.query(internal.keywords.get, { filename: 'names.txt' })

  expect(created.updated).toBe(false)
  expect(list).toHaveLength(1)
  expect(content).toBe('Alice\nBob')
  expect(removed).toEqual({ deleted: true })
  expect(missing).toBeNull()
})
