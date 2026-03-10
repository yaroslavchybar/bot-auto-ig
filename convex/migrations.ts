import { v } from 'convex/values'
import { internalMutation } from './_generated/server'

const LEGACY_LAST_OUTPUT_KEYS = ['mode', 'distribution', 'profileId', 'limit'] as const
const LEGACY_RESUME_KEYS = ['mode', 'distribution', 'profileId', 'limit'] as const

function hasOwn(doc: unknown, key: string): boolean {
  return typeof doc === 'object' && doc !== null && Object.prototype.hasOwnProperty.call(doc, key)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanLegacyLastOutput(lastOutput: unknown): {
  cleaned: unknown
  legacyRuntimeDetected: boolean
  unknownShape: boolean
} {
  if (typeof lastOutput === 'undefined') {
    return { cleaned: undefined, legacyRuntimeDetected: false, unknownShape: false }
  }

  if (lastOutput === null) {
    return { cleaned: null, legacyRuntimeDetected: false, unknownShape: false }
  }

  if (!isRecord(lastOutput)) {
    return { cleaned: lastOutput, legacyRuntimeDetected: false, unknownShape: true }
  }

  const next: Record<string, unknown> = { ...lastOutput }
  let legacyRuntimeDetected = false

  for (const key of LEGACY_LAST_OUTPUT_KEYS) {
    if (hasOwn(next, key)) {
      delete next[key]
      legacyRuntimeDetected = true
    }
  }

  if (hasOwn(next, 'resumeState')) {
    const resumeState = next.resumeState
    if (resumeState === null || typeof resumeState === 'undefined') {
      // No-op.
    } else if (!isRecord(resumeState)) {
      delete next.resumeState
      legacyRuntimeDetected = true
    } else {
      const resumeHasLegacyKey = LEGACY_RESUME_KEYS.some((key) => hasOwn(resumeState, key))
      if (resumeHasLegacyKey) {
        delete next.resumeState
        legacyRuntimeDetected = true
      }
    }
  }

  return { cleaned: next, legacyRuntimeDetected, unknownShape: false }
}

export const scraperAutoOnlyApplyProfileCleanup = internalMutation({
  args: {
    profileId: v.id('profiles'),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.profileId)
    if (!existing) {
      return { updated: false, removedAutomation: false }
    }

    const doc = existing as Record<string, unknown>
    const hadAutomation = hasOwn(doc, 'automation')
    if (!hadAutomation) {
      return { updated: false, removedAutomation: false }
    }

    await ctx.db.patch(args.profileId, {
      automation: undefined,
    } as any)

    return { updated: true, removedAutomation: true }
  },
})

export const scraperAutoOnlyApplyTaskCleanup = internalMutation({
  args: {
    taskId: v.id('scrapingTasks'),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.taskId)
    if (!existing) {
      return {
        updated: false,
        removedLegacyFields: 0,
        resetToIdle: false,
        clearedRuntimeState: false,
        unknownLastOutputShape: false,
      }
    }

    const doc = existing as Record<string, unknown>
    const status = String(existing.status ?? '').toLowerCase()
    const needsReset = status === 'running' || status === 'paused'
    const cleanedLastOutput = cleanLegacyLastOutput(existing.lastOutput)

    const patch: Record<string, unknown> = {}
    let removedLegacyFields = 0

    for (const key of ['mode', 'profileId', 'limit'] as const) {
      if (hasOwn(doc, key)) {
        patch[key] = undefined
        removedLegacyFields += 1
      }
    }

    if (needsReset) {
      patch.status = 'idle'
    }

    if (cleanedLastOutput.legacyRuntimeDetected) {
      patch.lastOutput = cleanedLastOutput.cleaned
    }

    if (Object.keys(patch).length === 0) {
      return {
        updated: false,
        removedLegacyFields,
        resetToIdle: needsReset,
        clearedRuntimeState: cleanedLastOutput.legacyRuntimeDetected,
        unknownLastOutputShape: cleanedLastOutput.unknownShape,
      }
    }

    patch.updatedAt = Date.now()
    await ctx.db.patch(args.taskId, patch as any)

    return {
      updated: true,
      removedLegacyFields,
      resetToIdle: needsReset,
      clearedRuntimeState: cleanedLastOutput.legacyRuntimeDetected,
      unknownLastOutputShape: cleanedLastOutput.unknownShape,
    }
  },
})

export const scraperAutoOnlyRollbackProfile = internalMutation({
  args: {
    profileId: v.id('profiles'),
    hadAutomation: v.boolean(),
    automation: v.optional(v.union(v.boolean(), v.null())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.profileId)
    if (!existing) {
      return { restored: false }
    }

    const patch: Record<string, unknown> = {}
    if (args.hadAutomation) {
      patch.automation = typeof args.automation === 'boolean' ? args.automation : undefined
    } else {
      patch.automation = undefined
    }

    await ctx.db.patch(args.profileId, patch as any)
    return { restored: true }
  },
})

export const scraperAutoOnlyRollbackTask = internalMutation({
  args: {
    taskId: v.id('scrapingTasks'),
    snapshot: v.any(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.taskId)
    if (!existing) {
      return { restored: false }
    }

    const snapshot = isRecord(args.snapshot) ? args.snapshot : {}
    const patch: Record<string, unknown> = {
      updatedAt: Date.now(),
    }

    patch.mode = hasOwn(snapshot, 'mode') ? snapshot.mode : undefined
    patch.profileId = hasOwn(snapshot, 'profileId') ? snapshot.profileId : undefined
    patch.limit = hasOwn(snapshot, 'limit') ? snapshot.limit : undefined
    patch.status = hasOwn(snapshot, 'status') ? snapshot.status : existing.status
    patch.lastOutput = hasOwn(snapshot, 'lastOutput') ? snapshot.lastOutput : existing.lastOutput

    await ctx.db.patch(args.taskId, patch as any)
    return { restored: true }
  },
})
