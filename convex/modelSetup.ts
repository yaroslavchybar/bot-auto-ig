import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'
import { DomainError } from './errors'
import { modelRoutine, recordedPostsReady } from './modelSetupPolicy'
import { OUTREACH_MIN_POSTS, randomInRange, warmupPostRange } from './routinePolicy'

export const modelSetupListInternal = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query('modelSetupStates').collect(),
})

export const modelSetupEnrollInternal = internalMutation({
  args: { profileId: v.id('profiles'), modelId: v.id('models'), startedAt: v.number() },
  handler: async (ctx, { profileId, modelId, startedAt }) => {
    if (startedAt < 1 || !Number.isSafeInteger(Math.ceil(startedAt)))
      throw new DomainError('VALIDATION', 'Invalid setup start time')
    const profile = await ctx.db.get(profileId)
    if (profile?.modelId !== modelId || !(await ctx.db.get(modelId)))
      throw new DomainError('VALIDATION', 'Profile is not assigned to this model')
    const existing = await ctx.db
      .query('modelSetupStates')
      .withIndex('by_profile', (q) => q.eq('profileId', profileId))
      .first()
    if (existing?.modelId === modelId) return existing
    if (existing?.pending)
      throw new DomainError(
        'CONFLICT',
        'Resolve the pending model setup action before changing models',
      )
    const postTarget = randomInRange(warmupPostRange(await modelRoutine(ctx, modelId)))
    const progress = {
      profileId,
      modelId,
      startedAt: Math.ceil(startedAt),
      postTarget,
      postSourceIds: [],
      postDates: [],
    }
    await ctx.db.patch(profileId, { outreachReady: false })
    if (existing) {
      await ctx.db.replace(existing._id, progress)
      return await ctx.db.get(existing._id)
    }
    return await ctx.db.get(await ctx.db.insert('modelSetupStates', progress))
  },
})

const modelSetupPatchKeys = new Set([
  'targetUsername',
  'fullName',
  'usernameDone',
  'fullNameDone',
  'avatarDone',
  'postSourceIds',
  'postDates',
  'outreachReadyMarked',
  'pending',
  'error',
])

export const modelSetupPatchInternal = internalMutation({
  args: {
    profileId: v.id('profiles'),
    modelId: v.id('models'),
    patch: v.any(),
    clear: v.array(v.string()),
  },
  handler: async (ctx, { profileId, modelId, patch, clear }) => {
    if (
      !patch ||
      typeof patch !== 'object' ||
      Array.isArray(patch) ||
      [...Object.keys(patch), ...clear].some((key) => !modelSetupPatchKeys.has(key))
    )
      throw new DomainError('VALIDATION', 'Invalid model setup update')
    if (
      patch.postSourceIds !== undefined &&
      (!Array.isArray(patch.postSourceIds) ||
        patch.postSourceIds.some((id: unknown) => typeof id !== 'string'))
    )
      throw new DomainError('VALIDATION', 'Invalid model setup update')
    if (
      patch.postDates !== undefined &&
      (!Array.isArray(patch.postDates) ||
        patch.postDates.some((date: unknown) => typeof date !== 'string'))
    )
      throw new DomainError('VALIDATION', 'Invalid model setup update')
    const state = await ctx.db
      .query('modelSetupStates')
      .withIndex('by_profile', (q) => q.eq('profileId', profileId))
      .first()
    if (!state) throw new DomainError('NOT_FOUND', 'Model setup not found')
    const profile = await ctx.db.get(profileId)
    if (state.modelId !== modelId || profile?.modelId !== modelId)
      throw new DomainError('CONFLICT', 'Profile moved to another model')
    const postsChanged = patch.postSourceIds !== undefined || patch.postDates !== undefined
    const ready = recordedPostsReady(
      patch.postSourceIds ?? state.postSourceIds,
      patch.postDates ?? state.postDates,
    )
    if (patch.outreachReadyMarked === true && !ready)
      throw new DomainError(
        'VALIDATION',
        `${OUTREACH_MIN_POSTS} recorded posts are required for outreach`,
      )
    await ctx.db.patch(state._id, {
      ...patch,
      ...Object.fromEntries(clear.map((key) => [key, undefined])),
      ...(postsChanged ? { outreachReadyMarked: ready ? true : undefined } : {}),
    })
    if (ready && !profile.outreachReady) await ctx.db.patch(profileId, { outreachReady: true })
    if (postsChanged && !ready && profile.outreachReady)
      await ctx.db.patch(profileId, { outreachReady: false })
  },
})

/** Resolve one uncertain Instagram action exactly once after a human checks the account. */
export const modelSetupReconcileInternal = internalMutation({
  args: {
    profileId: v.id('profiles'),
    resolution: v.union(v.literal('completed'), v.literal('failed')),
  },
  handler: async (ctx, { profileId, resolution }) => {
    const state = await ctx.db
      .query('modelSetupStates')
      .withIndex('by_profile', (q) => q.eq('profileId', profileId))
      .first()
    const profile = await ctx.db.get(profileId)
    if (!state?.pending || profile?.modelId !== state.modelId)
      throw new DomainError('CONFLICT', 'No active model setup action needs review')
    const action = state.pending
    if (resolution === 'failed') {
      await ctx.db.patch(state._id, { pending: undefined, error: undefined })
    } else if (action.kind === 'username') {
      if (!state.targetUsername) throw new DomainError('VALIDATION', 'Target username is missing')
      await ctx.db.patch(state._id, { usernameDone: true, pending: undefined, error: undefined })
    } else if (action.kind === 'fullName') {
      if (!state.fullName) throw new DomainError('VALIDATION', 'Target full name is missing')
      await ctx.db.patch(state._id, { fullNameDone: true, pending: undefined, error: undefined })
    } else if (action.kind === 'avatar') {
      await ctx.db.patch(state._id, { avatarDone: true, pending: undefined, error: undefined })
    } else {
      if (!action.sourceId) throw new DomainError('VALIDATION', 'Post source is missing')
      const postSourceIds = [...state.postSourceIds, action.sourceId]
      const postDates = [...state.postDates, action.date]
      const ready = recordedPostsReady(postSourceIds, postDates)
      await ctx.db.patch(state._id, {
        postSourceIds,
        postDates,
        pending: undefined,
        error: undefined,
        outreachReadyMarked: ready ? true : undefined,
      })
      if (ready && !profile.outreachReady) await ctx.db.patch(profileId, { outreachReady: true })
      if (!ready && profile.outreachReady) await ctx.db.patch(profileId, { outreachReady: false })
    }
    return { kind: action.kind, targetUsername: state.targetUsername }
  },
})

export const modelSetupGroupNameInternal = internalQuery({
  args: { modelId: v.id('models'), group: v.number() },
  handler: async (ctx, { modelId, group }) =>
    (
      await ctx.db
        .query('modelSetupGroupNames')
        .withIndex('by_model_group', (q) => q.eq('modelId', modelId).eq('group', group))
        .first()
    )?.name ?? null,
})

export const modelSetupSaveGroupNameInternal = internalMutation({
  args: { modelId: v.id('models'), group: v.number(), name: v.string() },
  handler: async (ctx, { modelId, group, name }) => {
    const existing = await ctx.db
      .query('modelSetupGroupNames')
      .withIndex('by_model_group', (q) => q.eq('modelId', modelId).eq('group', group))
      .first()
    if (existing) return existing.name
    await ctx.db.insert('modelSetupGroupNames', { modelId, group, name })
    return name
  },
})
