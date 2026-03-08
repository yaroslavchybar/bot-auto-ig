import { expect, test } from 'vitest'

import { api } from '../../convex/_generated/api'
import { createConvexTest, insertDoc, seedList } from './helpers'

test('creates, updates, and removes lists while clearing profile links', async () => {
  const t = createConvexTest()
  const list = await seedList(t, 'List A')
  const profile = await insertDoc(t, 'profiles', {
    createdAt: Date.now(),
    name: 'Profile A',
    using: false,
    testIp: false,
    login: true,
    mode: 'direct',
    listIds: [list!._id],
  })

  const updated = await t.mutation(api.lists.update, {
    id: list!._id,
    name: 'List B',
  })
  const removed = await t.mutation(api.lists.remove, { id: list!._id })
  const linkedProfile = await t.run(async (ctx) => ctx.db.get(profile!._id))

  expect(updated?.name).toBe('List B')
  expect(removed).toBe(true)
  expect(linkedProfile?.listIds).toEqual([])
})
