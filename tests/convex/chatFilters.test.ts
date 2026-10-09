import { expect, test } from 'vite-plus/test'
import { api } from '../../convex/_generated/api'
import { createConvexTest, seedProfile } from './helpers'

test('Chat matches Instagram IDs first, safely falls back to usernames, and returns only list metadata', async () => {
  const t = createConvexTest()
  const listId = await t.mutation(api.leads.createList, { name: 'Purpose' })
  await t.run(async (ctx) => {
    for (const [username, igId] of [
      ['renamed', '123'],
      ['legacy', undefined],
      ['reused', '456'],
    ] as const) {
      const leadId = await ctx.db.insert('leads', {
        username,
        igId,
        dmSent: false,
        followed: false,
        createdAt: 1,
      })
      await ctx.db.insert('leadMemberships', { leadId, listId, available: true, leadCreatedAt: 1 })
    }
  })
  const contacts = [
    { profileId: 'profile', igId: '123', username: 'old_name' },
    { profileId: 'profile', igId: '789', username: 'LEGACY' },
    { profileId: 'profile', igId: '999', username: 'reused' },
    { profileId: 'profile', igId: '111', username: 'unknown' },
  ]
  expect(await t.query(api.chatFilters.contacts, { contacts })).toEqual(
    contacts.map(({ profileId, igId }, index) => ({
      profileId,
      igId,
      listIds: index < 2 ? [listId] : [],
    })),
  )
})

test('confirmed outreach keeps its source list after membership changes, scoped to the sending profile', async () => {
  const t = createConvexTest()
  const profile = (await seedProfile(t))!
  const source = await t.mutation(api.leads.createList, { name: 'Original purpose' })
  const moved = await t.mutation(api.leads.createList, { name: 'Other purpose' })
  const leadId = await t.run(async (ctx) => {
    const id = await ctx.db.insert('leads', {
      username: 'recipient',
      igId: '123',
      senderId: profile._id,
      outreachListId: source,
      dmSent: true,
      followed: false,
      createdAt: 1,
    })
    await ctx.db.insert('leadMemberships', {
      leadId: id,
      listId: moved,
      available: false,
      leadCreatedAt: 1,
    })
    return id
  })
  const contacts = [
    { profileId: profile._id, igId: '123', username: 'recipient' },
    { profileId: 'other', igId: '123', username: 'recipient' },
  ]
  const query = () => t.query(api.chatFilters.contacts, { contacts })
  expect((await query()).map((row) => row.listIds)).toEqual([[source], [moved]])
  await t.run((ctx) => ctx.db.patch(leadId, { dmSent: false }))
  expect((await query()).map((row) => row.listIds)).toEqual([[moved], [moved]])
  await t.run(async (ctx) => {
    await ctx.db.patch(leadId, { dmSent: true })
    await ctx.db.delete(source)
  })
  expect((await query()).map((row) => row.listIds)).toEqual([[], [moved]])
})

test('contacts can belong to several scraped lists, ignoring deleted memberships', async () => {
  const t = createConvexTest()
  const first = await t.mutation(api.leads.createList, { name: 'First' })
  const second = await t.mutation(api.leads.createList, { name: 'Second' })
  await t.run(async (ctx) => {
    const leadId = await ctx.db.insert('leads', {
      username: 'contact',
      igId: '123',
      dmSent: false,
      followed: false,
      createdAt: 1,
    })
    for (const listId of [first, second])
      await ctx.db.insert('leadMemberships', { leadId, listId, available: true, leadCreatedAt: 1 })
  })
  const args = { contacts: [{ profileId: 'profile', igId: '123', username: 'contact' }] }
  expect((await t.query(api.chatFilters.contacts, args))[0].listIds.sort()).toEqual(
    [first, second].sort(),
  )
  await t.run((ctx) => ctx.db.delete(second))
  expect((await t.query(api.chatFilters.contacts, args))[0].listIds).toEqual([first])
})
