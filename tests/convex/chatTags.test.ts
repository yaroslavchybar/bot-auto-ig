import { afterEach, expect, test, vi } from 'vite-plus/test'
import { internal } from '../../convex/_generated/api'
import { createConvexTest, seedProfile } from './helpers'

afterEach(() => vi.unstubAllEnvs())

test('the tag HTTP bridge rejects anonymous calls and invalid keys for reads and writes', async () => {
  const t = createConvexTest()
  const profileId = (await seedProfile(t))!._id
  vi.stubEnv('INTERNAL_API_KEY', 'server-only-key')
  const body = JSON.stringify({ profileId, threadId: '1', tag: 'customer', enabled: true })
  for (const method of ['GET', 'POST']) {
    for (const headers of [{}, { authorization: 'Bearer wrong-key' }]) {
      const response = await t.fetch('/api/chat/tags', {
        method,
        headers,
        ...(method === 'POST' ? { body } : {}),
      })
      expect(response.status).toBe(401)
    }
  }
  expect(await t.query(internal.chatTags.list, {})).toEqual([])
  const headers = { authorization: 'Bearer server-only-key', 'content-type': 'application/json' }
  const saved = await t.fetch('/api/chat/tags', { method: 'POST', headers, body })
  expect(saved.status).toBe(200)
  const expected = [{ profileId, threadId: '1', tags: ['customer'] }]
  expect(await saved.json()).toEqual(expected)
  expect(await (await t.fetch('/api/chat/tags', { headers })).json()).toEqual(expected)
  const invalid = await t.fetch('/api/chat/tags', {
    method: 'POST',
    headers,
    body: JSON.stringify({ profileId, threadId: '1', tag: 'customer', enabled: 'true' }),
  })
  expect(invalid.status).toBe(400)
})

test('tag reads exclude deleted and deleting profiles rather than scanning all tag records', async () => {
  const t = createConvexTest()
  const active = (await seedProfile(t, { name: 'Active' }))!._id
  const deleting = (await seedProfile(t, { name: 'Deleting' }))!._id
  const deleted = (await seedProfile(t, { name: 'Deleted' }))!._id
  for (const profileId of [active, deleting, deleted])
    await t.mutation(internal.chatTags.toggle, {
      profileId,
      threadId: '1',
      tag: 'customer',
      enabled: true,
    })
  await t.mutation(internal.profiles.mutations.beginDeleteInternal, { name: 'Deleting' })
  await t.run((ctx) => ctx.db.delete(deleted))
  expect(await t.query(internal.chatTags.list, {})).toEqual([
    { profileId: active, threadId: '1', tags: ['customer'] },
  ])
})

test('tags are normalized, reusable, and isolated by profile and conversation', async () => {
  const t = createConvexTest()
  const first = (await seedProfile(t))!._id
  const second = (await seedProfile(t, { name: 'Profile B' }))!._id
  const add = (profileId: typeof first, threadId: string, tag: string) =>
    t.mutation(internal.chatTags.toggle, { profileId, threadId, tag, enabled: true })
  await add(first, '1', '  Hot   Lead  ')
  await add(first, '1', 'hot lead')
  await add(first, '1', 'customer')
  await add(first, '2', 'hot lead')
  await add(second, '1', 'customer')
  expect(await t.query(internal.chatTags.list, {})).toEqual([
    { profileId: first, threadId: '1', tags: ['customer', 'hot lead'] },
    { profileId: first, threadId: '2', tags: ['hot lead'] },
    { profileId: second, threadId: '1', tags: ['customer'] },
  ])
  await t.mutation(internal.chatTags.toggle, {
    profileId: first,
    threadId: '1',
    tag: 'HOT LEAD',
    enabled: false,
  })
  expect((await t.query(internal.chatTags.list, {}))[0].tags).toEqual(['customer'])
})

test('removing the last tag removes metadata and retries are harmless', async () => {
  const t = createConvexTest()
  const profileId = (await seedProfile(t))!._id
  const args = { profileId, threadId: '1', tag: 'customer' }
  await t.mutation(internal.chatTags.toggle, { ...args, enabled: true })
  await t.mutation(internal.chatTags.toggle, { ...args, enabled: false })
  await t.mutation(internal.chatTags.toggle, { ...args, enabled: false })
  expect(await t.query(internal.chatTags.list, {})).toEqual([])
})

test('invalid tags, thread IDs, unavailable profiles, and excessive tags are rejected', async () => {
  const t = createConvexTest()
  const profileId = (await seedProfile(t))!._id
  const args = { profileId, threadId: '1', tag: 'customer', enabled: true }
  for (const tag of ['', '   ', 'x'.repeat(41)])
    await expect(t.mutation(internal.chatTags.toggle, { ...args, tag })).rejects.toThrow('1–40')
  for (const threadId of ['', 'invalid', '1:2', '1'.repeat(41)])
    await expect(t.mutation(internal.chatTags.toggle, { ...args, threadId })).rejects.toThrow(
      'conversation ID',
    )
  for (let i = 0; i < 10; i++)
    await t.mutation(internal.chatTags.toggle, { ...args, tag: `tag${i}` })
  await expect(t.mutation(internal.chatTags.toggle, args)).rejects.toThrow('10 tags')
  // Existing tags can still be removed at the limit.
  await t.mutation(internal.chatTags.toggle, { ...args, tag: 'tag0', enabled: false })
  await t.mutation(internal.chatTags.toggle, args)
  await t.mutation(internal.profiles.mutations.beginDeleteInternal, { name: 'Profile A' })
  await expect(t.mutation(internal.chatTags.toggle, args)).rejects.toThrow('unavailable')
  await t.mutation(internal.profiles.mutations.removeByIdInternal, { profileId })
  await expect(t.mutation(internal.chatTags.toggle, args)).rejects.toThrow('unavailable')
})

test.each(['id', 'name'] as const)(
  'tags survive reconnects and are cleaned up on profile deletion by %s',
  async (method) => {
    const t = createConvexTest()
    const profileId = (await seedProfile(t))!._id
    const other = (await seedProfile(t, { name: 'Other' }))!._id
    for (const id of [profileId, other])
      await t.mutation(internal.chatTags.toggle, {
        profileId: id,
        threadId: '1',
        tag: 'customer',
        enabled: true,
      })
    for (const token of ['first-session', 'replacement-session']) {
      const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['{}'])))
      await t.mutation(internal.profiles.mutations.saveChatSessionInternal, {
        profileId,
        storageId,
        token,
      })
    }
    await t.mutation(internal.profiles.mutations.deleteChatSessionInternal, { profileId })
    expect(await t.query(internal.chatTags.list, {})).toHaveLength(2)
    await t.mutation(internal.profiles.mutations.beginDeleteInternal, { name: 'Profile A' })
    if (method === 'id')
      await t.mutation(internal.profiles.mutations.removeByIdInternal, { profileId })
    else await t.mutation(internal.profiles.mutations.removeByNameInternal, { name: 'Profile A' })
    expect(await t.query(internal.chatTags.list, {})).toEqual([
      { profileId: other, threadId: '1', tags: ['customer'] },
    ])
  },
)
