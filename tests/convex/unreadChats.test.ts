import { expect, test } from 'vite-plus/test'
import { convexTest } from 'convex-test'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
const modules = import.meta.glob('../../convex/**/*.ts')

test('browser unread counts replace old values, including zero, while stale observations are ignored', async () => {
  const t = convexTest(schema, modules)
  const profileId = await t.run(ctx => ctx.db.insert('profiles', { name: 'Profile', createdAt: 0, using: false }))
  const save = (count: number, checkedAt: number) => t.mutation(internal.profiles.mutations.saveUnreadChatsInternal, { profileId, count, checkedAt })
  await save(8, 100)
  expect((await t.query(api.profiles.queries.listPage, { search: '', cursor: null, pageSize: 50 })).page[0])
    .toMatchObject({ unreadChatCount: 8, unreadChatsCheckedAt: 100 })
  await save(0, 200)
  await save(9, 150)
  expect(await t.run(ctx => ctx.db.get(profileId))).toMatchObject({ unreadChatCount: 0, unreadChatsCheckedAt: 200 })
  for (const count of [-1, 1.5, 1_000_001]) await expect(save(count, 300)).rejects.toThrow('Invalid unread chat count')
  await t.run(ctx => ctx.db.patch(profileId, { status: 'deleting' }))
  await save(7, 400)
  expect((await t.run(ctx => ctx.db.get(profileId)))?.unreadChatCount).toBe(0)
})
