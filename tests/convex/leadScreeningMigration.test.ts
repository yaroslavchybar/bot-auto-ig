import { afterEach, expect, test, vi } from 'vite-plus/test'
import { convexTest } from 'convex-test'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import { modules } from './helpers'

// The first CI deployment accepts the old documents while running the cleanup.
const compatible = defineSchema({
  ...schema.tables,
  leads: defineTable({
    ...schema.tables.leads.validator.fields,
    profilePicUrl: v.optional(v.string()),
    profilePicDescription: v.optional(v.string()),
    pictureBatchId: v.optional(v.string()),
    enrichmentStatus: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('describing'),
        v.literal('ready'),
        v.literal('error'),
      ),
    ),
  })
    .index('by_username', ['username'])
    .index('by_ig_id', ['igId'])
    .index('by_classification', ['classification'])
    .index('by_dm_pending', ['senderId', 'dmEligible', 'dmStartedAt', 'unfollowAt'])
    .index('by_enrichment', ['enrichmentStatus'])
    .index('by_follow_due', ['senderId', 'followed', 'followDate'])
    .index('by_unfollow_due', ['senderId', 'followed', 'unfollowAt']),
  enrichmentWork: defineTable({ pending: v.boolean() }),
})

afterEach(() => vi.useRealTimers())

test('migration drops retired fields on every lead, preserves history and new decisions, and rebuilds counts', async () => {
  vi.useFakeTimers()
  const t = convexTest(compatible, modules)
  const before = await t.run(async (ctx) => {
    const senderId = await ctx.db.insert('profiles', { name: 'sender', using: false, createdAt: 0 })
    const listId = await ctx.db.insert('leadLists', { name: 'leads', createdAt: 0 })
    await ctx.db.insert('enrichmentWork', { pending: true })
    const base = {
      createdAt: 0,
      dmSent: false,
      followed: false,
      enrichmentStatus: 'ready' as const,
      classification: 'male' as const,
      profilePicUrl: 'old-url',
      profilePicDescription: 'old-description',
      pictureBatchId: 'old-batch',
    }
    const leads = []
    for (let i = 0; i < 205; i++) {
      const id = await ctx.db.insert('leads', {
        ...base,
        username: `legacy-${i}`,
        enrichmentModel: 'retired-model',
      })
      await ctx.db.insert('leadMemberships', {
        leadId: id,
        listId,
        leadCreatedAt: 0,
        available: false,
        classification: 'male',
      })
    }
    for (const [username, history] of [
      ['assigned', { senderId, outreachListId: listId, unfollowDays: 7 }],
      ['followed', { followed: true, followDate: 123, unfollowAt: 456 }],
      ['sent', { dmSent: true, dmStartedAt: 123, dmStartedDate: '2026-10-12' }],
      ['uncertain-follow', { followStartedAt: 123 }],
      ['uncertain-dm', { dmStartedAt: 123 }],
      ['blocked', { dmBlocked: true }],
      [
        'luna',
        {
          enrichmentModel: 'openai/gpt-6-luna-decisions',
          enrichedAt: 123,
          enrichmentConfidence: 0.95,
        },
      ],
      [
        'unclear',
        {
          classification: undefined,
          enrichmentModel: 'openai/gpt-6-luna-decisions',
          enrichedAt: 123,
          enrichmentConfidence: 0.2,
        },
      ],
    ] as const) {
      const id = await ctx.db.insert('leads', { ...base, username, ...history })
      await ctx.db.insert('leadMemberships', {
        leadId: id,
        listId,
        leadCreatedAt: 0,
        available: true,
      })
      leads.push((await ctx.db.get(id))!)
    }
    await ctx.db.insert('leads', {
      ...base,
      username: 'describing',
      enrichmentStatus: 'describing',
    })
    return leads
  })
  await t.mutation(api.leadStats.initialize, {})
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  await t.mutation(internal.migrations.leadScreening.start, {})
  await t.mutation(internal.migrations.leadScreening.start, {})
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  const rows = await t.run((ctx) => ctx.db.query('leads').collect())
  for (const row of rows) {
    expect(row).not.toHaveProperty('profilePicUrl')
    expect(row).not.toHaveProperty('profilePicDescription')
    expect(row).not.toHaveProperty('pictureBatchId')
  }
  for (const old of before) {
    const { profilePicUrl: _, profilePicDescription: __, pictureBatchId: ___, ...history } = old
    expect(rows.find((row) => row._id === old._id)).toEqual(history)
  }
  expect(rows.filter((row) => row.enrichmentStatus === 'pending')).toHaveLength(206)
  expect(
    rows
      .filter((row) => row.username.startsWith('legacy-'))
      .every((row) => !row.classification && !row.enrichmentModel),
  ).toBe(true)
  expect(await t.query(internal.migrations.leadScreening.migrationStatus, {})).toMatchObject({
    complete: true,
    processed: 214,
    reset: 206,
    cleaned: 214,
  })
  expect(await t.run((ctx) => ctx.db.query('enrichmentWork').collect())).toEqual([])
  const memberships = await t.run((ctx) => ctx.db.query('leadMemberships').collect())
  expect(memberships.filter((row) => !row.classification)).toHaveLength(206) // 205 legacy + unclear
  for (const lead of before.slice(0, 6))
    expect(memberships.find((row) => row.leadId === lead._id)?.available).toBe(false)
  expect(memberships.find((row) => row.leadId === before[7]._id)?.available).toBe(false)
  expect(await t.run((ctx) => ctx.db.query('leadStats').unique())).toMatchObject({
    complete: true,
    counts: { total: 214, pending: 206, enriched: 8, male: 7, assigned: 1, ready: 1 },
  })

  // Every cleaned record is accepted by the final strict schema.
  const strict = convexTest(schema, modules)
  await strict.run(async (ctx) => {
    for (const { _id: _, _creationTime: __, ...row } of rows) await ctx.db.insert('leads', row)
  })
  await t.mutation(internal.migrations.leadScreening.start, {})
  await t.mutation(internal.migrations.leadScreening.backfill, { cursor: null })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await t.run((ctx) => ctx.db.query('leads').collect())).toEqual(rows)
})

test('failed migration pages resume from the saved cursor without resetting completed pages', async () => {
  vi.useFakeTimers()
  const t = convexTest(compatible, modules)
  const { cursor, firstId } = await t.run(async (ctx) => {
    for (let i = 0; i < 101; i++)
      await ctx.db.insert('leads', {
        username: `legacy-${i}`,
        createdAt: 0,
        dmSent: false,
        followed: false,
        classification: 'female',
        enrichmentStatus: 'ready',
        profilePicDescription: 'old',
      })
    const page = await ctx.db.query('leads').paginate({ cursor: null, numItems: 100 })
    for (const lead of page.page)
      await ctx.db.patch(lead._id, {
        profilePicDescription: undefined,
        classification: undefined,
        enrichmentStatus: 'pending',
      })
    await ctx.db.patch(page.page[0]._id, {
      enrichmentStatus: 'ready',
      classification: 'male',
      enrichmentModel: 'openai/gpt-6-luna-decisions',
    })
    await ctx.db.insert('leadScreeningMigration', {
      cursor: page.continueCursor,
      complete: false,
      processed: 100,
      reset: 100,
      cleaned: 100,
    })
    return { cursor: page.continueCursor, firstId: page.page[0]._id }
  })
  await t.mutation(internal.migrations.leadScreening.start, {})
  await t.mutation(internal.migrations.leadScreening.backfill, { cursor: null })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await t.query(internal.migrations.leadScreening.migrationStatus, {})).toMatchObject({
    cursor: expect.any(String),
    complete: true,
    processed: 101,
    reset: 101,
    cleaned: 101,
  })
  expect(await t.run((ctx) => ctx.db.get(firstId))).toMatchObject({
    classification: 'male',
    enrichmentModel: 'openai/gpt-6-luna-decisions',
  })
  expect(
    (await t.run((ctx) => ctx.db.query('leads').collect())).filter(
      (lead) => !lead.profilePicDescription,
    ),
  ).toHaveLength(101)
  expect(cursor).toBeTruthy()
})
