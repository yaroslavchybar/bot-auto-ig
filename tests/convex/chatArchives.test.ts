import { afterEach, expect, test, vi } from 'vite-plus/test'
import { internal } from '../../convex/_generated/api'
import { createConvexTest, seedProfile } from './helpers'

afterEach(() => vi.unstubAllEnvs())

test('archive HTTP bridge authenticates reads and writes and validates status', async () => {
  const t = createConvexTest()
  const profileId = (await seedProfile(t))!._id
  vi.stubEnv('INTERNAL_API_KEY', 'server-only-key')
  const body = JSON.stringify({ profileId, threadId: '1', archived: true })
  for (const method of ['GET', 'POST']) {
    for (const headers of [{}, { authorization: 'Bearer wrong-key' }]) {
      const response = await t.fetch('/api/chat/archives', {
        method,
        headers,
        ...(method === 'POST' ? { body } : {}),
      })
      expect(response.status).toBe(401)
    }
  }
  expect(await t.query(internal.chatArchives.list, {})).toEqual([])
  const headers = { authorization: 'Bearer server-only-key', 'content-type': 'application/json' }
  const saved = await t.fetch('/api/chat/archives', { method: 'POST', headers, body })
  expect(saved.status).toBe(200)
  const expected = [{ profileId, threadId: '1' }]
  expect(await saved.json()).toEqual(expected)
  expect(await (await t.fetch('/api/chat/archives', { headers })).json()).toEqual(expected)
  const invalid = await t.fetch('/api/chat/archives', {
    method: 'POST',
    headers,
    body: JSON.stringify({ profileId, threadId: '1', archived: 'true' }),
  })
  expect(invalid.status).toBe(400)
})

test('archives are isolated by profile and conversation, and writes are idempotent', async () => {
  const t = createConvexTest()
  const first = (await seedProfile(t))!._id
  const second = (await seedProfile(t, { name: 'Profile B' }))!._id
  for (const [profileId, threadId] of [
    [first, '1'],
    [first, '2'],
    [second, '1'],
  ] as const) {
    for (let i = 0; i < 2; i++)
      await t.mutation(internal.chatArchives.setArchived, { profileId, threadId, archived: true })
  }
  expect(await t.query(internal.chatArchives.list, {})).toEqual([
    { profileId: first, threadId: '1' },
    { profileId: first, threadId: '2' },
    { profileId: second, threadId: '1' },
  ])
  for (let i = 0; i < 2; i++)
    await t.mutation(internal.chatArchives.setArchived, {
      profileId: first,
      threadId: '1',
      archived: false,
    })
  expect(await t.query(internal.chatArchives.list, {})).toEqual([
    { profileId: first, threadId: '2' },
    { profileId: second, threadId: '1' },
  ])
})

test('invalid conversations and unavailable profiles cannot be archived or restored', async () => {
  const t = createConvexTest()
  const profileId = (await seedProfile(t))!._id
  for (const archived of [true, false])
    for (const threadId of ['', 'invalid', '1:2', '1'.repeat(41)])
      await expect(
        t.mutation(internal.chatArchives.setArchived, { profileId, threadId, archived }),
      ).rejects.toThrow('conversation ID')
  await t.mutation(internal.chatArchives.setArchived, { profileId, threadId: '1', archived: true })
  await t.mutation(internal.profiles.mutations.beginDeleteInternal, { name: 'Profile A' })
  expect(await t.query(internal.chatArchives.list, {})).toEqual([])
  for (const archived of [true, false])
    await expect(
      t.mutation(internal.chatArchives.setArchived, { profileId, threadId: '1', archived }),
    ).rejects.toThrow('unavailable')
  await t.mutation(internal.profiles.mutations.removeByIdInternal, { profileId })
  await expect(
    t.mutation(internal.chatArchives.setArchived, { profileId, threadId: '1', archived: true }),
  ).rejects.toThrow('unavailable')
})

test.each(['id', 'name'] as const)(
  'archives survive reconnects and are deleted with the profile by %s',
  async (method) => {
    const t = createConvexTest()
    const profileId = (await seedProfile(t))!._id
    const other = (await seedProfile(t, { name: 'Other' }))!._id
    for (const id of [profileId, other])
      await t.mutation(internal.chatArchives.setArchived, {
        profileId: id,
        threadId: '1',
        archived: true,
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
    expect(await t.query(internal.chatArchives.list, {})).toHaveLength(2)
    await t.mutation(internal.profiles.mutations.beginDeleteInternal, { name: 'Profile A' })
    if (method === 'id')
      await t.mutation(internal.profiles.mutations.removeByIdInternal, { profileId })
    else await t.mutation(internal.profiles.mutations.removeByNameInternal, { name: 'Profile A' })
    expect(await t.query(internal.chatArchives.list, {})).toEqual([
      { profileId: other, threadId: '1' },
    ])
    expect(await t.run((ctx) => ctx.db.query('chatArchives').collect())).toHaveLength(1)
  },
)
