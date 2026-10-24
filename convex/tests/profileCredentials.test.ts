import { expect, test } from 'vite-plus/test'
import { internal } from '../_generated/api'
import { createConvexTest, seedProfile } from '../../tests/convex/helpers'

for (const status of ['assigned', 'connected', 'invalid'] as const) {
  test(`deleting a profile removes its ${status} credentials only after cleanup`, async () => {
    const t = createConvexTest()
    const profile = (await seedProfile(t, { name: 'Delete account' }))!
    const other = (await seedProfile(t, { name: 'Keep account' }))!
    const [accountId, duplicateId, otherAccountId, availableId] = await t.run(async ctx => {
      const accountId = await ctx.db.insert('igAccounts', {
        usernameHash: 'deleted', ciphertext: 'encrypted-deleted', status,
        profileId: profile._id, browserLoggedInAt: 1, createdAt: 1,
      })
      const duplicateId = await ctx.db.insert('igAccounts', {
        usernameHash: 'duplicate', ciphertext: 'encrypted-duplicate', status,
        profileId: profile._id, createdAt: 1,
      })
      const otherAccountId = await ctx.db.insert('igAccounts', {
        usernameHash: 'kept', ciphertext: 'encrypted-kept', status: 'connected',
        profileId: other._id, createdAt: 1,
      })
      const availableId = await ctx.db.insert('igAccounts', {
        usernameHash: 'unused', ciphertext: 'encrypted-unused', status: 'available', createdAt: 1,
      })
      await ctx.db.patch(profile._id, { igAccountId: accountId, igLoggedIn: true })
      await ctx.db.patch(other._id, { igAccountId: otherAccountId })
      return [accountId, duplicateId, otherAccountId, availableId] as const
    })
    const remove = () => t.mutation(internal.profiles.mutations.removeByIdInternal, { profileId: profile._id })

    await expect(remove()).rejects.toThrow(/Begin profile deletion/)
    await t.mutation(internal.profiles.mutations.beginDeleteInternal, { name: profile.name })
    expect(await t.run(ctx => ctx.db.get(accountId))).not.toBeNull()
    expect(await t.run(ctx => ctx.db.get(duplicateId))).not.toBeNull()
    await remove()
    await remove() // Retried cleanup must remain safe.
    expect(await t.run(ctx => ctx.db.get(profile._id))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(accountId))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(duplicateId))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(otherAccountId))).not.toBeNull()
    expect(await t.run(ctx => ctx.db.get(availableId))).not.toBeNull()
    expect(await t.run(ctx => ctx.db.get(other._id))).not.toBeNull()
  })
}
