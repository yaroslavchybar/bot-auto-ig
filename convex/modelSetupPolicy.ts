import type { Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { OUTREACH_MIN_POSTS, randomInRange, warmupPostRange, type RoutinePolicy } from './routinePolicy'

export async function modelRoutine(ctx: QueryCtx, modelId: Id<'models'>) {
  return (await ctx.db.query('automations').collect())
    .find(row => row.routine && row.modelIds?.includes(modelId))?.routine
}

/** Outreach needs three confirmed posts, independently of the publishing target. */
export function recordedPostsReady(sourceIds: string[], dates: string[]) {
  return sourceIds.length >= OUTREACH_MIN_POSTS && sourceIds.length === dates.length
}

/** A changed range assigns new targets only to unfinished accounts, keeping their posts. */
export async function updateWarmupPostTargets(ctx: MutationCtx, modelId: Id<'models'>, policy: RoutinePolicy) {
  const states = await ctx.db.query('modelSetupStates')
    .withIndex('by_model', q => q.eq('modelId', modelId)).collect()
  for (const state of states) {
    if (state.postSourceIds.length >= (state.postTarget ?? 9)) continue
    const profile = await ctx.db.get(state.profileId)
    if (profile?.modelId !== modelId) continue
    const postTarget = randomInRange(warmupPostRange(policy))
    const ready = recordedPostsReady(state.postSourceIds, state.postDates)
    await ctx.db.patch(state._id, { postTarget, outreachReadyMarked: ready ? true : undefined })
    await ctx.db.patch(profile._id, { outreachReady: ready })
  }
}
