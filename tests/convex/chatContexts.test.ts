import { afterEach, expect, test, vi } from 'vite-plus/test'
import { api, internal } from '../../convex/_generated/api'
import { createConvexTest, seedProfile } from './helpers'

afterEach(() => vi.unstubAllEnvs())

test('worker contexts authenticate and expose revisions without downloading session data', async () => {
  vi.stubEnv('INTERNAL_API_KEY', 'test-key')
  const t = createConvexTest()
  const args = { bridgeToken: 'test-key', subscriptionId: 'worker' }
  const read = () => t.query(api.profiles.queries.chatWorkerContexts, args)
  await expect(
    t.query(api.profiles.queries.chatWorkerContexts, { ...args, bridgeToken: 'wrong' }),
  ).rejects.toThrow('Unauthorized')
  const profileId = (await seedProfile(t, { proxy: 'localhost:8080', proxyType: 'http' }))!._id
  await t.run((ctx) => ctx.db.patch(profileId, { igLoggedIn: true }))
  expect(await read()).toEqual([])
  const token = '11111111-1111-4111-8111-111111111111'
  let storageId = await t.run((ctx) => ctx.storage.store(new Blob(['private cookies'])))
  await t.mutation(internal.profiles.mutations.saveChatSessionInternal, {
    profileId,
    storageId,
    token,
  })
  expect(await read()).toEqual([
    {
      profileId,
      storageId,
      token,
      enabled: true,
      reconnectRequired: false,
      proxy: 'http://localhost:8080',
      proxyType: 'http',
    },
  ])
  await t.run((ctx) => ctx.db.patch(profileId, { proxy: 'localhost:8081', proxyType: 'socks5' }))
  expect((await read())[0]).toMatchObject({
    storageId,
    proxy: 'localhost:8081',
    proxyType: 'socks5',
  })
  storageId = await t.run((ctx) => ctx.storage.store(new Blob(['new cookies'])))
  await t.mutation(internal.profiles.mutations.saveChatSessionInternal, {
    profileId,
    storageId,
    token,
    expectedToken: token,
    reconnectRequired: true,
  })
  expect((await read())[0]).toMatchObject({ storageId, enabled: false, reconnectRequired: true })
  await t.mutation(internal.profiles.mutations.saveChatSessionInternal, {
    profileId,
    storageId,
    token,
    expectedToken: token,
  })
  await t.run((ctx) => ctx.db.patch(profileId, { igLoggedIn: false }))
  expect((await read())[0]).toMatchObject({ enabled: false, reconnectRequired: false })
  await t.run((ctx) => ctx.db.patch(profileId, { status: 'deleting' }))
  expect(await read()).toEqual([])
  await t.run((ctx) => ctx.db.patch(profileId, { status: 'idle' }))
  await t.mutation(internal.profiles.mutations.deleteChatSessionInternal, { profileId })
  expect(await read()).toEqual([])
})
