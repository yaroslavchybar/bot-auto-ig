import { v } from 'convex/values'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import { mutation, query } from './auth'

type ScrapeKind = 'followers' | 'following'
type ScrapeStatus =
  | 'idle'
  | 'queued'
  | 'leasing'
  | 'running'
  | 'paused'
  | 'retry_wait'
  | 'completed'
  | 'failed'
  | 'cancelled'

type TaskStats = {
  scraped: number
  deduped: number
  chunksCompleted: number
  targetsCompleted: number
}

const ACTIVE_STATUSES = new Set<ScrapeStatus>(['leasing', 'running'])
const RUNNABLE_STATUSES = new Set<ScrapeStatus>(['queued', 'retry_wait'])
const LEASE_RECOVERY_DELAY_MS = 30_000

function cleanString(value: unknown): string {
  return String(value ?? '').trim()
}

function normalizeKind(value: unknown): ScrapeKind {
  return cleanString(value).toLowerCase() === 'following' ? 'following' : 'followers'
}

function normalizeStatus(value: unknown): ScrapeStatus {
  const status = cleanString(value).toLowerCase()
  switch (status) {
    case 'idle':
    case 'queued':
    case 'leasing':
    case 'running':
    case 'paused':
    case 'retry_wait':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return status
    default:
      throw new Error(`Invalid scraping task status: ${cleanString(value) || '(empty)'}`)
  }
}

function normalizeMaxAttempts(value: unknown): number {
  const raw = Number(value)
  if (!Number.isFinite(raw)) return 8
  return Math.max(1, Math.min(20, Math.floor(raw)))
}

function normalizeTargets(targetsRaw: unknown, targetUsernameRaw: unknown): string[] {
  const values = Array.isArray(targetsRaw)
    ? targetsRaw
    : typeof targetUsernameRaw === 'string'
      ? targetUsernameRaw
          .split(/\r?\n/)
          .flatMap((line) => line.split(','))
      : []

  const seen = new Set<string>()
  const targets: string[] = []

  for (const raw of values) {
    const cleaned = cleanString(raw).replace(/^@+/, '')
    if (!cleaned) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    targets.push(cleaned)
  }

  if (targets.length === 0) {
    throw new Error('targets are required')
  }

  return targets
}

function packTargets(targets: string[]): string {
  return targets.join('\n')
}

function defaultStats(existing?: Partial<TaskStats> | null): TaskStats {
  return {
    scraped: Number.isFinite(Number(existing?.scraped)) ? Math.max(0, Math.floor(Number(existing?.scraped))) : 0,
    deduped: Number.isFinite(Number(existing?.deduped)) ? Math.max(0, Math.floor(Number(existing?.deduped))) : 0,
    chunksCompleted: Number.isFinite(Number(existing?.chunksCompleted)) ? Math.max(0, Math.floor(Number(existing?.chunksCompleted))) : 0,
    targetsCompleted: Number.isFinite(Number(existing?.targetsCompleted)) ? Math.max(0, Math.floor(Number(existing?.targetsCompleted))) : 0,
  }
}

function asTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : null
}

function isExpired(ts: unknown, now: number): boolean {
  const timestamp = asTimestamp(ts)
  return timestamp !== null && timestamp <= now
}

function canEditTask(status: ScrapeStatus): boolean {
  return !ACTIVE_STATUSES.has(status)
}

async function getTask(ctx: any, id: any) {
  return (await ctx.db.get(id)) ?? null
}

async function listTasksByKind(ctx: any, kindRaw?: unknown) {
  const kind = cleanString(kindRaw)
  const rows = kind
    ? await ctx.db.query('scrapingTasks').withIndex('by_kind', (q: any) => q.eq('kind', normalizeKind(kind))).collect()
    : await ctx.db.query('scrapingTasks').collect()
  rows.sort((a: any, b: any) => b.createdAt - a.createdAt)
  return rows
}

async function listUnimportedTasksByKind(ctx: any, kindRaw?: unknown) {
  const rows = await listTasksByKind(ctx, kindRaw)
  return rows.filter(
    (task: any) =>
      task.imported !== true &&
      normalizeStatus(task.status ?? 'idle') === 'completed' &&
      (task.manifestStorageId || task.storageId || task.exportStorageId),
  )
}

function buildTaskInsert(args: {
  name: string
  kind?: string
  targetUsername?: string
  targets?: string[]
  maxAttempts?: number
  initialStatus: ScrapeStatus
}) {
  const name = cleanString(args.name)
  if (!name) throw new Error('name is required')

  const targets = normalizeTargets(args.targets, args.targetUsername)
  const now = Date.now()

  return {
    name,
    kind: normalizeKind(args.kind),
    targetUsername: packTargets(targets),
    targets,
    imported: false,
    status: args.initialStatus,
    currentTargetIndex: 0,
    cursor: undefined,
    attempt: 0,
    maxAttempts: normalizeMaxAttempts(args.maxAttempts),
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    heartbeatAt: undefined,
    assignedProfileId: undefined,
    assignedProfileName: undefined,
    lastError: undefined,
    lastErrorCode: undefined,
    lastErrorMessage: undefined,
    lastRunAt: undefined,
    lastScraped: undefined,
    storageId: undefined,
    manifestStorageId: undefined,
    exportStorageId: undefined,
    stats: defaultStats(),
    startedAt: undefined,
    completedAt: undefined,
    nextRunAt: args.initialStatus === 'queued' ? now : undefined,
    chunkRefs: [],
    createdAt: now,
    updatedAt: now,
  }
}

function buildResetPatch(existing: any, now: number) {
  const targets = Array.isArray(existing?.targets) && existing.targets.length > 0
    ? existing.targets
    : normalizeTargets(undefined, existing?.targetUsername)

  return {
    status: 'queued' as ScrapeStatus,
    targetUsername: packTargets(targets),
    targets,
    currentTargetIndex: 0,
    cursor: undefined,
    attempt: 0,
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    heartbeatAt: undefined,
    assignedProfileId: undefined,
    assignedProfileName: undefined,
    lastError: undefined,
    lastErrorCode: undefined,
    lastErrorMessage: undefined,
    lastRunAt: now,
    lastScraped: undefined,
    storageId: undefined,
    manifestStorageId: undefined,
    exportStorageId: undefined,
    stats: defaultStats(),
    startedAt: undefined,
    completedAt: undefined,
    nextRunAt: now,
    chunkRefs: [],
    updatedAt: now,
  }
}

async function releaseAssignedProfile(ctx: any, task: any) {
  if (!task?.assignedProfileId) return
  const profile = await ctx.db.get(task.assignedProfileId)
  if (!profile) return
  await ctx.db.patch(profile._id, {
    scrapeLeaseOwner: undefined,
    scrapeLeaseExpiresAt: undefined,
  })
}

function getCurrentTarget(task: any): string | null {
  const targets = Array.isArray(task?.targets) ? task.targets : []
  const index = typeof task?.currentTargetIndex === 'number' ? task.currentTargetIndex : 0
  return index >= 0 && index < targets.length ? cleanString(targets[index]) || null : null
}

export const list = query({
  args: { kind: v.optional(v.string()) },
  handler: async (ctx, args) => await listTasksByKind(ctx, args.kind),
})

export const listInternal = internalQuery({
  args: { kind: v.optional(v.string()) },
  handler: async (ctx, args) => await listTasksByKind(ctx, args.kind),
})

export const getById = query({
  args: { id: v.id('scrapingTasks') },
  handler: async (ctx, args) => await getTask(ctx, args.id),
})

export const getByIdInternal = internalQuery({
  args: { id: v.id('scrapingTasks') },
  handler: async (ctx, args) => await getTask(ctx, args.id),
})

export const listUnimported = query({
  args: { kind: v.optional(v.string()) },
  handler: async (ctx, args) => await listUnimportedTasksByKind(ctx, args.kind),
})

export const listUnimportedInternal = internalQuery({
  args: { kind: v.optional(v.string()) },
  handler: async (ctx, args) => await listUnimportedTasksByKind(ctx, args.kind),
})

export const create = mutation({
  args: {
    name: v.string(),
    kind: v.optional(v.string()),
    targetUsername: v.optional(v.string()),
    targets: v.optional(v.array(v.string())),
    maxAttempts: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('scrapingTasks', buildTaskInsert({ ...args, initialStatus: 'idle' }))
    return await getTask(ctx, id)
  },
})

export const createInternal = internalMutation({
  args: {
    name: v.string(),
    kind: v.optional(v.string()),
    targetUsername: v.optional(v.string()),
    targets: v.optional(v.array(v.string())),
    maxAttempts: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('scrapingTasks', buildTaskInsert({ ...args, initialStatus: 'idle' }))
    return await getTask(ctx, id)
  },
})

export const update = mutation({
  args: {
    id: v.id('scrapingTasks'),
    name: v.optional(v.string()),
    kind: v.optional(v.string()),
    targetUsername: v.optional(v.string()),
    targets: v.optional(v.array(v.string())),
    maxAttempts: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await getTask(ctx, args.id)
    if (!existing) throw new Error('Task not found')
    if (!canEditTask(normalizeStatus(existing.status ?? 'idle'))) {
      throw new Error('Cannot edit a running task')
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() }
    if (args.name !== undefined) {
      const name = cleanString(args.name)
      if (!name) throw new Error('name is required')
      patch.name = name
    }
    if (args.kind !== undefined) patch.kind = normalizeKind(args.kind)
    if (args.targetUsername !== undefined || args.targets !== undefined) {
      const targets = normalizeTargets(args.targets ?? existing.targets, args.targetUsername ?? existing.targetUsername)
      patch.targets = targets
      patch.targetUsername = packTargets(targets)
    }
    if (args.maxAttempts !== undefined) {
      patch.maxAttempts = normalizeMaxAttempts(args.maxAttempts)
    }

    await ctx.db.patch(args.id, patch)
    return await getTask(ctx, args.id)
  },
})

export const remove = mutation({
  args: { id: v.id('scrapingTasks') },
  handler: async (ctx, args) => {
    const existing = await getTask(ctx, args.id)
    if (!existing) return true
    if (!canEditTask(normalizeStatus(existing.status ?? 'idle'))) {
      throw new Error('Cannot delete a running task')
    }
    await ctx.db.delete(args.id)
    return true
  },
})

export const setImported = mutation({
  args: { id: v.id('scrapingTasks'), imported: v.boolean() },
  handler: async (ctx, args) => {
    const existing = await getTask(ctx, args.id)
    if (!existing) throw new Error('Task not found')
    await ctx.db.patch(args.id, {
      imported: Boolean(args.imported),
      updatedAt: Date.now(),
    })
    return await getTask(ctx, args.id)
  },
})

export const setImportedInternal = internalMutation({
  args: { id: v.id('scrapingTasks'), imported: v.boolean() },
  handler: async (ctx, args) => {
    const existing = await getTask(ctx, args.id)
    if (!existing) throw new Error('Task not found')
    await ctx.db.patch(args.id, {
      imported: Boolean(args.imported),
      updatedAt: Date.now(),
    })
    return await getTask(ctx, args.id)
  },
})

export const setStatus = mutation({
  args: {
    id: v.id('scrapingTasks'),
    status: v.string(),
    lastError: v.optional(v.string()),
    lastErrorCode: v.optional(v.string()),
    lastErrorMessage: v.optional(v.string()),
    lastScraped: v.optional(v.number()),
    lastRunAt: v.optional(v.number()),
    storageId: v.optional(v.id('_storage')),
    manifestStorageId: v.optional(v.id('_storage')),
    exportStorageId: v.optional(v.id('_storage')),
    lastOutput: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const existing = await getTask(ctx, args.id)
    if (!existing) throw new Error('Task not found')

    const patch: Record<string, unknown> = {
      status: normalizeStatus(args.status),
      updatedAt: Date.now(),
    }
    if (args.lastRunAt !== undefined) patch.lastRunAt = Math.max(0, Math.floor(args.lastRunAt))
    if (args.lastScraped !== undefined) patch.lastScraped = Math.max(0, Math.floor(args.lastScraped))
    if (args.lastError !== undefined) patch.lastError = cleanString(args.lastError) || undefined
    if (args.lastErrorCode !== undefined) patch.lastErrorCode = cleanString(args.lastErrorCode) || undefined
    if (args.lastErrorMessage !== undefined) patch.lastErrorMessage = cleanString(args.lastErrorMessage) || undefined
    if (args.storageId !== undefined) patch.storageId = args.storageId
    if (args.manifestStorageId !== undefined) patch.manifestStorageId = args.manifestStorageId
    if (args.exportStorageId !== undefined) patch.exportStorageId = args.exportStorageId
    if (args.lastOutput !== undefined) patch.lastOutput = args.lastOutput

    await ctx.db.patch(args.id, patch)
    return await getTask(ctx, args.id)
  },
})

export const startInternal = internalMutation({
  args: { id: v.id('scrapingTasks') },
  handler: async (ctx, args) => {
    const existing = await getTask(ctx, args.id)
    if (!existing) throw new Error('Task not found')
    await ctx.db.patch(args.id, buildResetPatch(existing, Date.now()))
    return await getTask(ctx, args.id)
  },
})

export const enqueueInternal = startInternal

export const pauseInternal = internalMutation({
  args: { id: v.id('scrapingTasks') },
  handler: async (ctx, args) => {
    const existing = await getTask(ctx, args.id)
    if (!existing) throw new Error('Task not found')
    const now = Date.now()
    await releaseAssignedProfile(ctx, existing)
    await ctx.db.patch(args.id, {
      status: 'paused',
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      heartbeatAt: undefined,
      assignedProfileId: undefined,
      assignedProfileName: undefined,
      nextRunAt: undefined,
      updatedAt: now,
    })
    return await getTask(ctx, args.id)
  },
})

export const resumeInternal = internalMutation({
  args: { id: v.id('scrapingTasks') },
  handler: async (ctx, args) => {
    const existing = await getTask(ctx, args.id)
    if (!existing) throw new Error('Task not found')
    const now = Date.now()
    const status = normalizeStatus(existing.status ?? 'idle')

    if (status === 'paused' || status === 'retry_wait' || status === 'failed' || status === 'cancelled' || status === 'completed') {
      await ctx.db.patch(args.id, {
        status: 'queued',
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        heartbeatAt: undefined,
        assignedProfileId: undefined,
        assignedProfileName: undefined,
        lastError: undefined,
        lastErrorCode: undefined,
        lastErrorMessage: undefined,
        nextRunAt: now,
        updatedAt: now,
      })
      return await getTask(ctx, args.id)
    }

    return existing
  },
})

export const cancelInternal = internalMutation({
  args: { id: v.id('scrapingTasks') },
  handler: async (ctx, args) => {
    const existing = await getTask(ctx, args.id)
    if (!existing) throw new Error('Task not found')
    const now = Date.now()
    await releaseAssignedProfile(ctx, existing)
    await ctx.db.patch(args.id, {
      status: 'cancelled',
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      heartbeatAt: undefined,
      assignedProfileId: undefined,
      assignedProfileName: undefined,
      nextRunAt: undefined,
      completedAt: now,
      updatedAt: now,
    })
    return await getTask(ctx, args.id)
  },
})

export const claimNextInternal = internalMutation({
  args: {
    workerId: v.string(),
    now: v.number(),
    leaseMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const workerId = cleanString(args.workerId)
    if (!workerId) throw new Error('workerId is required')

    const now = Math.max(0, Math.floor(args.now))
    const leaseMs = Math.max(15_000, Math.floor(Number(args.leaseMs ?? 90_000)))
    const rows = await ctx.db.query('scrapingTasks').collect()
    const task = rows
      .filter((row: any) => {
        const status = normalizeStatus(row.status ?? 'idle')
        if (!RUNNABLE_STATUSES.has(status)) return false
        if (status === 'retry_wait' && typeof row.nextRunAt === 'number' && row.nextRunAt > now) return false
        if (cleanString(row.leaseOwner) && !isExpired(row.leaseExpiresAt, now)) return false
        return true
      })
      .sort((a: any, b: any) => {
        const aNext = typeof a.nextRunAt === 'number' ? a.nextRunAt : a.createdAt
        const bNext = typeof b.nextRunAt === 'number' ? b.nextRunAt : b.createdAt
        if (aNext !== bNext) return aNext - bNext
        return a.createdAt - b.createdAt
      })[0]

    if (!task) return null

    await ctx.db.patch(task._id, {
      status: 'leasing',
      leaseOwner: workerId,
      leaseExpiresAt: now + leaseMs,
      heartbeatAt: now,
      lastRunAt: now,
      updatedAt: now,
    })
    return await getTask(ctx, task._id)
  },
})

export const noteRunningInternal = internalMutation({
  args: {
    taskId: v.id('scrapingTasks'),
    workerId: v.string(),
    profileId: v.id('profiles'),
    now: v.number(),
    leaseMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const task = await getTask(ctx, args.taskId)
    if (!task) throw new Error('Task not found')
    const workerId = cleanString(args.workerId)
    if (cleanString(task.leaseOwner) !== workerId) {
      throw new Error('Task is not leased by this worker')
    }

    const profile = await ctx.db.get(args.profileId)
    if (!profile) throw new Error('Profile not found')

    const now = Math.max(0, Math.floor(args.now))
    const leaseMs = Math.max(15_000, Math.floor(Number(args.leaseMs ?? 90_000)))
    await ctx.db.patch(args.taskId, {
      status: 'running',
      assignedProfileId: profile._id,
      assignedProfileName: profile.name,
      startedAt: typeof task.startedAt === 'number' ? task.startedAt : now,
      heartbeatAt: now,
      leaseExpiresAt: now + leaseMs,
      updatedAt: now,
    })
    return await getTask(ctx, args.taskId)
  },
})

export const heartbeatInternal = internalMutation({
  args: {
    taskId: v.id('scrapingTasks'),
    workerId: v.string(),
    now: v.number(),
    leaseMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const task = await getTask(ctx, args.taskId)
    if (!task) return null
    if (cleanString(task.leaseOwner) !== cleanString(args.workerId)) {
      return task
    }

    const now = Math.max(0, Math.floor(args.now))
    const leaseMs = Math.max(15_000, Math.floor(Number(args.leaseMs ?? 90_000)))
    await ctx.db.patch(args.taskId, {
      heartbeatAt: now,
      leaseExpiresAt: now + leaseMs,
      updatedAt: now,
    })
    return await getTask(ctx, args.taskId)
  },
})

export const appendChunkInternal = internalMutation({
  args: {
    taskId: v.id('scrapingTasks'),
    workerId: v.string(),
    now: v.number(),
    storageId: v.id('_storage'),
    targetUsername: v.string(),
    scraped: v.number(),
    hasMore: v.boolean(),
    nextCursor: v.optional(v.string()),
    sourceProfileId: v.optional(v.id('profiles')),
    sourceProfileName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const task = await getTask(ctx, args.taskId)
    if (!task) throw new Error('Task not found')
    if (cleanString(task.leaseOwner) !== cleanString(args.workerId)) {
      throw new Error('Task is not leased by this worker')
    }

    const now = Math.max(0, Math.floor(args.now))
    const scraped = Math.max(0, Math.floor(args.scraped))
    const stats = defaultStats(task.stats)
    const chunkRefs = Array.isArray(task.chunkRefs) ? [...task.chunkRefs] : []

    chunkRefs.push({
      storageId: args.storageId,
      targetUsername: cleanString(args.targetUsername),
      sequence: chunkRefs.length,
      sourceProfileId: args.sourceProfileId,
      sourceProfileName: cleanString(args.sourceProfileName) || undefined,
      scrapedAt: now,
      count: scraped,
    })

    stats.scraped += scraped
    stats.chunksCompleted += 1

    let currentTargetIndex = typeof task.currentTargetIndex === 'number' ? task.currentTargetIndex : 0
    let cursor = cleanString(args.nextCursor) || undefined
    if (!args.hasMore) {
      currentTargetIndex += 1
      cursor = undefined
      stats.targetsCompleted += 1
    }

    await ctx.db.patch(args.taskId, {
      chunkRefs,
      currentTargetIndex,
      cursor,
      lastScraped: scraped,
      lastRunAt: now,
      heartbeatAt: now,
      stats,
      updatedAt: now,
    })
    return await getTask(ctx, args.taskId)
  },
})

export const markRetryInternal = internalMutation({
  args: {
    taskId: v.id('scrapingTasks'),
    workerId: v.string(),
    now: v.number(),
    errorCode: v.string(),
    errorMessage: v.string(),
    retryDelayMs: v.number(),
  },
  handler: async (ctx, args) => {
    const task = await getTask(ctx, args.taskId)
    if (!task) throw new Error('Task not found')

    const now = Math.max(0, Math.floor(args.now))
    const nextAttempt = Math.max(0, Math.floor(Number(task.attempt ?? 0))) + 1
    await releaseAssignedProfile(ctx, task)
    await ctx.db.patch(args.taskId, {
      status: nextAttempt >= normalizeMaxAttempts(task.maxAttempts) ? 'failed' : 'retry_wait',
      attempt: nextAttempt,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      heartbeatAt: now,
      assignedProfileId: undefined,
      assignedProfileName: undefined,
      nextRunAt: nextAttempt >= normalizeMaxAttempts(task.maxAttempts)
        ? undefined
        : now + Math.max(1_000, Math.floor(args.retryDelayMs)),
      completedAt: nextAttempt >= normalizeMaxAttempts(task.maxAttempts) ? now : undefined,
      lastError: cleanString(args.errorMessage),
      lastErrorCode: cleanString(args.errorCode),
      lastErrorMessage: cleanString(args.errorMessage),
      updatedAt: now,
    })
    return await getTask(ctx, args.taskId)
  },
})

export const markFailedInternal = internalMutation({
  args: {
    taskId: v.id('scrapingTasks'),
    workerId: v.string(),
    now: v.number(),
    errorCode: v.string(),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await getTask(ctx, args.taskId)
    if (!task) throw new Error('Task not found')

    const now = Math.max(0, Math.floor(args.now))
    await releaseAssignedProfile(ctx, task)
    await ctx.db.patch(args.taskId, {
      status: 'failed',
      attempt: Math.max(0, Math.floor(Number(task.attempt ?? 0))) + 1,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      heartbeatAt: now,
      assignedProfileId: undefined,
      assignedProfileName: undefined,
      nextRunAt: undefined,
      completedAt: now,
      lastError: cleanString(args.errorMessage),
      lastErrorCode: cleanString(args.errorCode),
      lastErrorMessage: cleanString(args.errorMessage),
      updatedAt: now,
    })
    return await getTask(ctx, args.taskId)
  },
})

export const markCompletedInternal = internalMutation({
  args: {
    taskId: v.id('scrapingTasks'),
    workerId: v.string(),
    now: v.number(),
    manifestStorageId: v.id('_storage'),
    exportStorageId: v.optional(v.id('_storage')),
    deduped: v.number(),
  },
  handler: async (ctx, args) => {
    const task = await getTask(ctx, args.taskId)
    if (!task) throw new Error('Task not found')

    const now = Math.max(0, Math.floor(args.now))
    const stats = defaultStats(task.stats)
    stats.deduped = Math.max(0, Math.floor(args.deduped))

    await releaseAssignedProfile(ctx, task)
    await ctx.db.patch(args.taskId, {
      status: 'completed',
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      heartbeatAt: now,
      assignedProfileId: undefined,
      assignedProfileName: undefined,
      nextRunAt: undefined,
      completedAt: now,
      manifestStorageId: args.manifestStorageId,
      exportStorageId: args.exportStorageId,
      storageId: args.exportStorageId ?? args.manifestStorageId,
      stats,
      lastError: undefined,
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
      updatedAt: now,
    })
    return await getTask(ctx, args.taskId)
  },
})

export const recoverExpiredLeasesInternal = internalMutation({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const now = Math.max(0, Math.floor(args.now))
    const rows = await ctx.db.query('scrapingTasks').collect()
    let reclaimed = 0

    for (const task of rows) {
      const status = normalizeStatus(task.status ?? 'idle')
      if (!ACTIVE_STATUSES.has(status)) continue
      if (!cleanString(task.leaseOwner) || !isExpired(task.leaseExpiresAt, now)) continue

      await releaseAssignedProfile(ctx, task)
      const shouldRetry = Math.max(0, Math.floor(Number(task.attempt ?? 0))) > 0
      await ctx.db.patch(task._id, {
        status: shouldRetry ? 'retry_wait' : 'queued',
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        heartbeatAt: undefined,
        assignedProfileId: undefined,
        assignedProfileName: undefined,
        nextRunAt: shouldRetry ? now + LEASE_RECOVERY_DELAY_MS : now,
        updatedAt: now,
      })
      reclaimed += 1
    }

    return { reclaimed }
  },
})

export const storeArtifactInternal = internalAction({
  args: { payload: v.any() },
  handler: async (ctx, args) => {
    const blob = new Blob([JSON.stringify(args.payload ?? {}, null, 2)], {
      type: 'application/json',
    })
    const storageId = await ctx.storage.store(blob)
    return { storageId }
  },
})

export const storeScrapedData = internalAction({
  args: {
    taskId: v.id('scrapingTasks'),
    users: v.array(v.any()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const payload = {
      taskId: args.taskId,
      users: args.users,
      metadata: args.metadata ?? {},
      count: Array.isArray(args.users) ? args.users.length : 0,
      scrapedAt: Date.now(),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    })
    const storageId = await ctx.storage.store(blob)
    return {
      storageId,
      count: payload.count,
    }
  },
})

export const getStorageUrl = query({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, args) => await ctx.storage.getUrl(args.storageId),
})

export const getStorageUrlInternal = internalQuery({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, args) => await ctx.storage.getUrl(args.storageId),
})

export const getManifestUrl = query({
  args: { id: v.id('scrapingTasks') },
  handler: async (ctx, args) => {
    const task = await getTask(ctx, args.id)
    if (!task?.manifestStorageId) return null
    return await ctx.storage.getUrl(task.manifestStorageId)
  },
})

export const getManifestUrlInternal = internalQuery({
  args: { id: v.id('scrapingTasks') },
  handler: async (ctx, args) => {
    const task = await getTask(ctx, args.id)
    if (!task?.manifestStorageId) return null
    return await ctx.storage.getUrl(task.manifestStorageId)
  },
})

export const currentTargetInternal = internalQuery({
  args: { id: v.id('scrapingTasks') },
  handler: async (ctx, args) => {
    const task = await getTask(ctx, args.id)
    if (!task) return null
    return {
      targetUsername: getCurrentTarget(task),
      cursor: cleanString(task.cursor) || null,
      currentTargetIndex: typeof task.currentTargetIndex === 'number' ? task.currentTargetIndex : 0,
      targets: Array.isArray(task.targets) ? task.targets : [],
    }
  },
})
