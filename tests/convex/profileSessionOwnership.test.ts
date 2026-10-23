import { expect, test } from 'vite-plus/test'
import { internal } from '../../convex/_generated/api'
import { createConvexTest } from './helpers'

test('a replaced browser cannot clear runtime status or overwrite its successor cookies', async () => {
  const t = createConvexTest()
  const id = await t.run((ctx) =>
    ctx.db.insert('profiles', { name: 'fixture', inUse: false, createdAt: 0 }),
  )
  const status = (browserSessionId: string, state: string) =>
    t.mutation(internal.profiles.mutations.syncStatusInternal, {
      name: 'fixture',
      status: state,
      inUse: state === 'running',
      browserSessionId,
    })
  const save = (browserSessionId: string, value: string) =>
    t.mutation(internal.profiles.mutations.updateByNameInternal, {
      oldName: 'fixture',
      name: 'fixture',
      browserSessionId,
      cookiesJson: JSON.stringify([
        { name: 'sessionid', value, domain: '.instagram.com', path: '/' },
      ]),
    })
  await status('old-owner', 'running')
  await save('old-owner', 'old-cookie')
  await status('new-owner', 'running')
  await save('new-owner', 'new-cookie')
  expect(await status('old-owner', 'idle')).toBe(false)
  await expect(save('old-owner', 'stale-cookie')).rejects.toThrow(/no longer owns/)
  const active = await t.run((ctx) => ctx.db.get(id))
  expect(active).toMatchObject({
    status: 'running',
    inUse: true,
    browserSessionId: 'new-owner',
    instagramSessionId: 'new-cookie',
  })
  await expect(
    t.mutation(internal.profiles.mutations.updateByNameInternal, {
      oldName: 'fixture',
      name: 'fixture',
      cookiesJson: '[]',
    }),
  ).rejects.toThrow(/Close the browser/)
  await status('new-owner', 'idle')
  await expect(save('new-owner', 'late-cookie')).rejects.toThrow(/no longer owns/)
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
    status: 'idle',
    inUse: false,
    instagramSessionId: 'new-cookie',
  })
})

test('startup claims reject stale revisions after close or cookie import and remain retry-safe', async () => {
  const t = createConvexTest()
  const id = await t.run((ctx) =>
    ctx.db.insert('profiles', { name: 'fixture', inUse: false, createdAt: 0 }),
  )
  const claim = (
    browserSessionId: string,
    previousBrowserSessionRevision: number,
    profileId = id,
  ) =>
    t.mutation(internal.profiles.mutations.syncStatusInternal, {
      name: 'fixture',
      status: 'running',
      inUse: true,
      browserSessionId,
      profileId,
      previousBrowserSessionRevision,
    })
  const close = (browserSessionId: string) =>
    t.mutation(internal.profiles.mutations.syncStatusInternal, {
      name: 'fixture',
      status: 'idle',
      inUse: false,
      browserSessionId,
    })
  expect(await claim('first', 0)).toBe(true)
  expect(await claim('first', 0)).toBe(true)
  expect((await t.run((ctx) => ctx.db.get(id)))?.browserSessionRevision).toBe(1)
  expect(await claim('late', 0)).toBe(false)
  await close('first')
  expect(await claim('first', 0)).toBe(false)
  expect(await claim('second', 1)).toBe(true)
  await close('second')
  expect(await claim('late', 1)).toBe(false)
  await t.mutation(internal.profiles.mutations.updateByNameInternal, {
    oldName: (await t.run(ctx => ctx.db.get(id)))!.name,
    name: 'fixture',
    cookiesJson: '[]',
  })
  expect(await claim('late', 2)).toBe(false)
  const unrelated = await t.run((ctx) =>
    ctx.db.insert('profiles', { name: 'other', inUse: false, createdAt: 0 }),
  )
  expect(await claim('wrong-profile', 3, unrelated)).toBe(false)
  expect(await claim('fresh', 3)).toBe(true)
})

test('lease recovery invalidates a pending startup claim before a replacement can start', async () => {
  const t = createConvexTest()
  const id = await t.run(ctx => ctx.db.insert('profiles', {
    name: 'fixture', inUse: false, createdAt: 0,
  }))
  const status = (browserSessionId: string, revision: number, running: boolean, profileId = id) =>
    t.mutation(internal.profiles.mutations.syncStatusInternal, {
      name: 'fixture', profileId, browserSessionId,
      previousBrowserSessionRevision: revision,
      status: running ? 'running' : 'idle', inUse: running,
    })
  // Recovery wins the race with a running request still in flight.
  expect(await status('dead', 0, false)).toBe(true)
  expect(await status('dead', 0, false)).toBe(true)
  expect(await status('dead', 0, true)).toBe(false)
  expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({
    status: 'idle', inUse: false, browserSessionRevision: 1,
  })
  expect(await status('replacement', 1, true)).toBe(true)
  expect(await status('dead', 0, false)).toBe(false)
  expect(await status('dead', 0, true)).toBe(false)
  expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({
    status: 'running', inUse: true, browserSessionId: 'replacement', browserSessionRevision: 2,
  })
  // A committed claim is retired by the same release operation; retries stay idempotent.
  expect(await status('replacement', 1, false)).toBe(true)
  expect(await status('replacement', 1, false)).toBe(true)
  expect(await status('replacement', 1, true)).toBe(false)
  const other = await t.run(ctx => ctx.db.insert('profiles', {
    name: 'other', inUse: false, createdAt: 0,
  }))
  expect(await status('wrong-profile', 2, false, other)).toBe(false)
  // An idle cookie import also invalidates the captured lease revision.
  await t.mutation(internal.profiles.mutations.updateByNameInternal, { oldName: (await t.run(ctx => ctx.db.get(id)))!.name, name: 'fixture', cookiesJson: '[]' })
  expect(await status('pending-before-import', 2, false)).toBe(false)
  expect(await status('pending-before-import', 2, true)).toBe(false)
  expect(await status('fresh', 3, true)).toBe(true)
})
