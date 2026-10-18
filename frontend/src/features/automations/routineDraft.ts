import {
  defaultRoutine,
  outreachRoutes,
  validateRoutine,
  type RoutinePolicy,
} from '../../../../convex/routinePolicy'
import type { Id } from '../../../../convex/_generated/dataModel'
import { isBrowsingSetting } from '../../../../server/shared/browsingSettings'

/** Translate saved settings into the editable draft without using presentation metadata. */
export function routineDraft(saved?: RoutinePolicy): RoutinePolicy {
  const initial = saved ?? defaultRoutine
  const { outreachStartDay: _outreachStartDay, dailyIncrease: _dailyIncrease, ...current } = initial
  const { warmup_topics, ...activity } = initial.activity
  return {
    ...current,
    activity: Object.fromEntries(
      Object.entries(activity).filter(([key]) => isBrowsingSetting(key)),
    ),
    interests:
      initial.interests ??
      (typeof warmup_topics === 'string' && warmup_topics.trim()
        ? [{ label: warmup_topics.trim().slice(0, 300), description: warmup_topics.trim() }]
        : []),
    leadListId: undefined,
    message: '',
    outreachRoutes: outreachRoutes(initial),
  }
}

export function routinePayload(name: string, modelIds: Id<'models'>[], policy: RoutinePolicy) {
  validateRoutine(policy)
  return { name: name.trim(), modelIds, routine: policy }
}

export function routineProblem(policy: RoutinePolicy) {
  try {
    validateRoutine(policy)
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
