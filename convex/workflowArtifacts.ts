import { v } from 'convex/values'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import { mutation, query } from './auth'

type ArtifactKind = 'followers' | 'following'

type ArtifactStats = {
  scraped: number
  deduped: number
  chunksCompleted: number
  targetsCompleted: number
}

function cleanString(value: unknown): string {
  return String(value ?? '').trim()
}

function normalizeKind(value: unknown): ArtifactKind {
  return cleanString(value).toLowerCase() === 'following' ? 'following' : 'followers'
}

function normalizeTargets(targetsRaw: unknown, targetUsernameRaw?: unknown): string[] {
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
  return targets
}

function packTargets(targets: string[]): string {
  return targets.join('\n')
}

function defaultStats(existing?: Partial<ArtifactStats> | null): ArtifactStats {
  return {
    scraped: Number.isFinite(Number(existing?.scraped))
      ? Math.max(0, Math.floor(Number(existing?.scraped)))
      : 0,
    deduped: Number.isFinite(Number(existing?.deduped))
      ? Math.max(0, Math.floor(Number(existing?.deduped)))
      : 0,
    chunksCompleted: Number.isFinite(Number(existing?.chunksCompleted))
      ? Math.max(0, Math.floor(Number(existing?.chunksCompleted)))
      : 0,
    targetsCompleted: Number.isFinite(Number(existing?.targetsCompleted))
      ? Math.max(0, Math.floor(Number(existing?.targetsCompleted)))
      : 0,
  }
}

async function getArtifact(ctx: any, id: any) {
  return (await ctx.db.get(id)) ?? null
}

async function listArtifactsByWorkflow(ctx: any, workflowId: any) {
  const rows = await ctx.db
    .query('workflowArtifacts')
    .withIndex('by_workflowId', (q: any) => q.eq('workflowId', workflowId))
    .collect()
  const filtered = await filterVisibleArtifacts(ctx, rows)
  filtered.sort((a: any, b: any) => b.updatedAt - a.updatedAt)
  return filtered
}

async function listAllArtifacts(ctx: any) {
  const rows = await ctx.db.query('workflowArtifacts').collect()
  const filtered = await filterVisibleArtifacts(ctx, rows)
  filtered.sort((a: any, b: any) => {
    const bTs = Number.isFinite(Number(b?.updatedAt))
      ? Number(b.updatedAt)
      : Number(b?.createdAt) || 0
    const aTs = Number.isFinite(Number(a?.updatedAt))
      ? Number(a.updatedAt)
      : Number(a?.createdAt) || 0
    return bTs - aTs
  })
  return filtered
}

async function listUnimportedArtifacts(ctx: any, kindRaw?: unknown) {
  const rows = await ctx.db.query('workflowArtifacts').collect()
  const filtered = rows.filter((row: any) => {
    if (row.imported === true) return false
    if (cleanString(row.status || 'completed').toLowerCase() !== 'completed') return false
    if (!row.storageId && !row.exportStorageId && !row.manifestStorageId) return false
    if (kindRaw === undefined || kindRaw === null || cleanString(kindRaw) === '') return true
    return normalizeKind(row.kind) === normalizeKind(kindRaw)
  })
  const available = await filterVisibleArtifacts(ctx, filtered)
  available.sort((a: any, b: any) => b.updatedAt - a.updatedAt)
  return available
}

async function upsertArtifactRow(
  ctx: any,
  args: {
    workflowId: any
    workflowName: string
    nodeId: string
    nodeLabel?: string
    name?: string
    kind?: string
    targets?: string[]
    targetUsername?: string
    status?: string
    sourceProfileName?: string
    lastRunAt?: number
    storageId?: any
    manifestStorageId?: any
    exportStorageId?: any
    stats?: Partial<ArtifactStats>
    metadata?: any
  },
) {
  const workflowName = cleanString(args.workflowName)
  const nodeId = cleanString(args.nodeId)
  if (!workflowName) throw new Error('workflowName is required')
  if (!nodeId) throw new Error('nodeId is required')

  const now = Date.now()
  const targets = normalizeTargets(args.targets, args.targetUsername)
  const name =
    cleanString(args.name) ||
    `${workflowName} · ${cleanString(args.nodeLabel) || nodeId}`

  const row = {
    name,
    workflowId: args.workflowId,
    workflowName,
    nodeId,
    nodeLabel: cleanString(args.nodeLabel) || undefined,
    kind: normalizeKind(args.kind),
    targetUsername: packTargets(targets),
    targets,
    status: cleanString(args.status) || 'completed',
    imported: false,
    sourceProfileName: cleanString(args.sourceProfileName) || undefined,
    lastRunAt:
      typeof args.lastRunAt === 'number' && Number.isFinite(args.lastRunAt)
        ? Math.max(0, Math.floor(args.lastRunAt))
        : now,
    storageId: args.storageId,
    manifestStorageId: args.manifestStorageId,
    exportStorageId: args.exportStorageId,
    stats: defaultStats(args.stats),
    metadata: args.metadata,
    createdAt: now,
    updatedAt: now,
  }
  const inserted = await ctx.db.insert('workflowArtifacts', row)
  return await getArtifact(ctx, inserted)
}

function collectArtifactStorageIds(row: any): any[] {
  const uniqueIds = new Set<string>()
  const storageIds: any[] = []
  for (const candidate of [row?.storageId, row?.exportStorageId, row?.manifestStorageId]) {
    const cleaned = cleanString(candidate)
    if (!cleaned || uniqueIds.has(cleaned)) continue
    uniqueIds.add(cleaned)
    storageIds.push(candidate)
  }
  return storageIds
}

async function artifactHasAvailableStorage(ctx: any, row: any): Promise<boolean> {
  const storageIds = collectArtifactStorageIds(row)
  if (storageIds.length === 0) return true
  for (const storageId of storageIds) {
    try {
      const url = await ctx.storage.getUrl(storageId)
      if (typeof url === 'string' && url.trim()) return true
    } catch {
      continue
    }
  }
  return false
}

async function artifactWorkflowExists(ctx: any, row: any): Promise<boolean> {
  try {
    return Boolean(await ctx.db.get(row?.workflowId))
  } catch {
    return false
  }
}

async function filterVisibleArtifacts(ctx: any, rows: any[]) {
  const results = await Promise.all(
    rows.map(async (row) => {
      if (!(await artifactWorkflowExists(ctx, row))) return null
      return (await artifactHasAvailableStorage(ctx, row)) ? row : null
    }),
  )
  return results.filter(Boolean)
}

export const listByWorkflow = query({
  args: { workflowId: v.id('workflows') },
  handler: async (ctx, args) => await listArtifactsByWorkflow(ctx, args.workflowId),
})

export const listAll = query({
  args: {},
  handler: async (ctx) => await listAllArtifacts(ctx),
})

export const listByWorkflowInternal = internalQuery({
  args: { workflowId: v.id('workflows') },
  handler: async (ctx, args) => await listArtifactsByWorkflow(ctx, args.workflowId),
})

export const listUnimported = query({
  args: { kind: v.optional(v.string()) },
  handler: async (ctx, args) => await listUnimportedArtifacts(ctx, args.kind),
})

export const listUnimportedInternal = internalQuery({
  args: { kind: v.optional(v.string()) },
  handler: async (ctx, args) => await listUnimportedArtifacts(ctx, args.kind),
})

export const getById = query({
  args: { id: v.id('workflowArtifacts') },
  handler: async (ctx, args) => await getArtifact(ctx, args.id),
})

export const getByIdInternal = internalQuery({
  args: { id: v.id('workflowArtifacts') },
  handler: async (ctx, args) => await getArtifact(ctx, args.id),
})

export const upsert = mutation({
  args: {
    workflowId: v.id('workflows'),
    workflowName: v.string(),
    nodeId: v.string(),
    nodeLabel: v.optional(v.string()),
    name: v.optional(v.string()),
    kind: v.optional(v.string()),
    targets: v.optional(v.array(v.string())),
    targetUsername: v.optional(v.string()),
    status: v.optional(v.string()),
    sourceProfileName: v.optional(v.string()),
    lastRunAt: v.optional(v.number()),
    storageId: v.optional(v.id('_storage')),
    manifestStorageId: v.optional(v.id('_storage')),
    exportStorageId: v.optional(v.id('_storage')),
    stats: v.optional(
      v.object({
        scraped: v.optional(v.number()),
        deduped: v.optional(v.number()),
        chunksCompleted: v.optional(v.number()),
        targetsCompleted: v.optional(v.number()),
      }),
    ),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => await upsertArtifactRow(ctx, args),
})

export const upsertInternal = internalMutation({
  args: {
    workflowId: v.id('workflows'),
    workflowName: v.string(),
    nodeId: v.string(),
    nodeLabel: v.optional(v.string()),
    name: v.optional(v.string()),
    kind: v.optional(v.string()),
    targets: v.optional(v.array(v.string())),
    targetUsername: v.optional(v.string()),
    status: v.optional(v.string()),
    sourceProfileName: v.optional(v.string()),
    lastRunAt: v.optional(v.number()),
    storageId: v.optional(v.id('_storage')),
    manifestStorageId: v.optional(v.id('_storage')),
    exportStorageId: v.optional(v.id('_storage')),
    stats: v.optional(
      v.object({
        scraped: v.optional(v.number()),
        deduped: v.optional(v.number()),
        chunksCompleted: v.optional(v.number()),
        targetsCompleted: v.optional(v.number()),
      }),
    ),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => await upsertArtifactRow(ctx, args),
})

export const setImported = mutation({
  args: { id: v.id('workflowArtifacts'), imported: v.boolean() },
  handler: async (ctx, args) => {
    const existing = await getArtifact(ctx, args.id)
    if (!existing) throw new Error('Artifact not found')
    await ctx.db.patch(args.id, {
      imported: Boolean(args.imported),
      updatedAt: Date.now(),
    })
    return await getArtifact(ctx, args.id)
  },
})

export const setImportedInternal = internalMutation({
  args: { id: v.id('workflowArtifacts'), imported: v.boolean() },
  handler: async (ctx, args) => {
    const existing = await getArtifact(ctx, args.id)
    if (!existing) throw new Error('Artifact not found')
    await ctx.db.patch(args.id, {
      imported: Boolean(args.imported),
      updatedAt: Date.now(),
    })
    return await getArtifact(ctx, args.id)
  },
})

export const remove = mutation({
  args: { id: v.id('workflowArtifacts') },
  handler: async (ctx, args) => {
    const existing = await getArtifact(ctx, args.id)
    if (!existing) throw new Error('Artifact not found')

    for (const storageId of collectArtifactStorageIds(existing)) {
      try {
        await ctx.storage.delete(storageId)
      } catch (error) {
        const message = String((error as any)?.message || error || '')
        if (!message.toLowerCase().includes('not found')) {
          throw error
        }
      }
    }

    await ctx.db.delete(args.id)
    return existing
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

export const getStorageUrl = query({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, args) => await ctx.storage.getUrl(args.storageId),
})

export const getStorageUrlInternal = internalQuery({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, args) => await ctx.storage.getUrl(args.storageId),
})
