import { expect, test } from 'vitest'

import { api } from '../_generated/api'
import { createConvexTest } from './helpers'

test('upserts, lists, reads, and removes keyword files', async () => {
  const t = createConvexTest()

  const created = await t.mutation(api.keywords.upsert, {
    filename: 'names.txt',
    content: 'Alice\nBob',
  })
  const list = await t.query(api.keywords.list, {})
  const content = await t.query(api.keywords.get, { filename: 'names.txt' })
  const removed = await t.mutation(api.keywords.remove, { filename: 'names.txt' })
  const missing = await t.query(api.keywords.get, { filename: 'names.txt' })

  expect(created.updated).toBe(false)
  expect(list).toHaveLength(1)
  expect(content).toBe('Alice\nBob')
  expect(removed).toEqual({ deleted: true })
  expect(missing).toBeNull()
})
