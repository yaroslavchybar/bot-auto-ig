import { DomainError } from './errors'
import { v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'

export const list = query({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query('models').collect()).sort((a, b) => a.createdAt - b.createdAt),
})

const identity = {
  name: v.string(),
  baseFullName: v.optional(v.string()),
  fullNameVariations: v.optional(v.array(v.string())),
  usernames: v.optional(v.array(v.string())),
}

export const create = mutation({
  args: identity,
  handler: async (ctx, args) => {
    const name = args.name.trim()
    if (!name) throw new DomainError('VALIDATION', 'name is required')
    const id = await ctx.db.insert('models', {
      name,
      baseFullName: args.baseFullName?.trim(),
      fullNameVariations: cleanFullNames(args.fullNameVariations),
      usernames: cleanUsernames(args.usernames),
      createdAt: Date.now(),
    })
    // Content storage uses its own stable identity.
    await ctx.db.patch(id, { contentKey: String(id) })
    return ctx.db.get(id)
  },
})

export const update = mutation({
  args: { id: v.id('models'), ...identity },
  handler: async (ctx, args) => {
    const name = args.name.trim()
    if (!name) throw new DomainError('VALIDATION', 'name cannot be empty')
    await ctx.db.patch(args.id, {
      name,
      ...(args.baseFullName !== undefined ? { baseFullName: args.baseFullName.trim() } : {}),
      ...(args.fullNameVariations !== undefined
        ? { fullNameVariations: cleanFullNames(args.fullNameVariations) }
        : {}),
      ...(args.usernames !== undefined ? { usernames: cleanUsernames(args.usernames) } : {}),
    })
    return ctx.db.get(args.id)
  },
})

function cleanUsernames(input: string[] | undefined) {
  const names = (input ?? []).map((name) => name.trim().replace(/^@/, '').toLowerCase())
  if (names.some((name) => !/^[a-z0-9._]{1,30}$/.test(name)))
    throw new DomainError('VALIDATION', 'Invalid Instagram username')
  return [...new Set(names)]
}
function cleanFullNames(input: string[] | undefined) {
  const names = (input ?? []).map((name) => name.trim()).filter(Boolean)
  if (
    names.some(
      (name) => !/^[\p{L}\p{M}\p{Extended_Pictographic}\p{Emoji_Component} .'-]{3,80}$/u.test(name),
    )
  )
    throw new DomainError(
      'VALIDATION',
      'Full names must be 3–80 letters, emoji, or name punctuation',
    )
  return [...new Set(names)]
}

export const remove = mutation({
  args: { id: v.id('models') },
  handler: async (ctx, { id }) => {
    const model = await ctx.db.get(id)
    if (!model) return true
    const profiles = (await ctx.db.query('profiles').collect()).filter((p) =>
      p.modelIds?.includes(id),
    )
    const automations = (await ctx.db.query('automations').collect()).filter((a) =>
      a.modelIds?.includes(id),
    )
    const states = await ctx.db
      .query('modelSetupStates')
      .withIndex('by_model', (q) => q.eq('modelId', id))
      .collect()
    if (states.some((s) => s.pending))
      throw new DomainError(
        'CONFLICT',
        'Resolve pending model setup actions before deleting the model',
      )
    if (
      profiles.some(
        (p) =>
          p.inUse ||
          ['running', 'starting', 'deleting'].includes(p.status ?? '') ||
          p.pendingRenameFrom,
      ) ||
      automations.some((a) => a.status === 'running' || (a.routine && a.isActive))
    )
      throw new DomainError(
        'CONFLICT',
        'Disable the automation and stop profiles before deleting the model',
      )
    for (const profile of profiles)
      await ctx.db.patch(profile._id, {
        modelIds: profile.modelIds?.filter((value) => value !== id),
        outreachReady: false,
      })
    for (const row of await ctx.db
      .query('profileModelAssignments')
      .withIndex('by_model', (q) => q.eq('modelId', id))
      .collect())
      await ctx.db.delete(row._id)
    for (const automation of automations)
      await ctx.db.patch(automation._id, {
        modelIds: automation.modelIds?.filter((value) => value !== id),
      })
    for (const state of states) await ctx.db.delete(state._id)
    for (const row of await ctx.db
      .query('modelSetupGroupNames')
      .withIndex('by_model_group', (q) => q.eq('modelId', id))
      .collect())
      await ctx.db.delete(row._id)
    await ctx.db.delete(id)
    await ctx.db.insert('modelContentCleanup', { contentKey: model.contentKey ?? String(id) })
    return true
  },
})

export const finishContentCleanupInternal = internalMutation({
  args: { contentKey: v.string() },
  handler: async (ctx, { contentKey }) => {
    for (const row of await ctx.db
      .query('modelContentCleanup')
      .withIndex('by_content', (q) => q.eq('contentKey', contentKey))
      .collect())
      await ctx.db.delete(row._id)
  },
})

export const queueContentCleanupInternal = internalMutation({
  args: { contentKey: v.string() },
  handler: async (ctx, { contentKey }) => {
    if (!/^[a-zA-Z0-9_-]{4,100}$/.test(contentKey))
      throw new DomainError('VALIDATION', 'Invalid content key')
    if (
      (await ctx.db.query('models').collect()).some(
        (model) => (model.contentKey ?? String(model._id)) === contentKey,
      )
    )
      return
    if (
      !(await ctx.db
        .query('modelContentCleanup')
        .withIndex('by_content', (q) => q.eq('contentKey', contentKey))
        .first())
    )
      await ctx.db.insert('modelContentCleanup', { contentKey })
  },
})
