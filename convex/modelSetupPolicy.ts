import type { Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { randomInRange, warmupPostRange, type RoutinePolicy } from './routinePolicy'

export async function modelRoutine(ctx: QueryCtx, modelId: Id<'lists'>) {
  return (await ctx.db.query('automations').collect())
    .find(row => row.routine && row.listIds?.includes(modelId))?.routine
}

export function recordedPostsReady(sourceIds: string[], dates: string[], target = 9) {
  return sourceIds.length >= target && sourceIds.length === dates.length
}

/** A changed range assigns new targets only to unfinished accounts, keeping their posts. */
export async function updateWarmupPostTargets(ctx: MutationCtx, modelId: Id<'lists'>, policy: RoutinePolicy) {
  const states = await ctx.db.query('modelSetupStates')
    .withIndex('by_model', q => q.eq('modelId', modelId)).collect()
  for (const state of states) {
    if (state.outreachReadyMarked) continue
    const profile = await ctx.db.get(state.profileId)
    if (!profile?.listIds?.includes(modelId)) continue
    const postTarget = randomInRange(warmupPostRange(policy))
    const ready = !state.pending && recordedPostsReady(state.postSourceIds, state.postDates, postTarget)
    await ctx.db.patch(state._id, { postTarget, outreachReadyMarked: ready ? true : undefined })
    await ctx.db.patch(profile._id, { outreachReady: ready })
  }
}
