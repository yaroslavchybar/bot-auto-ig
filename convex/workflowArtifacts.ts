import { DomainError } from './errors';
import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'
// NOTE: browser-called queries/mutations below are intentionally public.
// Admin-only access is enforced by the Express session login; the browser
// Convex client carries no identity since Clerk was removed.
import { mutation, query } from './_generated/server'

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
    localArtifactPath?: string
    localArtifactDeletedAt?: number
    imported?: boolean
    stats?: Partial<ArtifactStats>
    metadata?: any
  },
) {
  const workflowName = cleanString(args.workflowName)
  const nodeId = cleanString(args.nodeId)
  if (!workflowName) throw new DomainError('VALIDATION', 'workflowName is required')
  if (!nodeId) throw new DomainError('VALIDATION', 'nodeId is required')

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
    imported: args.imported === true,
    sourceProfileName: cleanString(args.sourceProfileName) || undefined,
    lastRunAt:
      typeof args.lastRunAt === 'number' && Number.isFinite(args.lastRunAt)
        ? Math.max(0, Math.floor(args.lastRunAt))
        : now,
    localArtifactPath: cleanString(args.localArtifactPath) || undefined,
    localArtifactDeletedAt:
      typeof args.localArtifactDeletedAt === 'number' && Number.isFinite(args.localArtifactDeletedAt)
        ? Math.max(0, Math.floor(args.localArtifactDeletedAt))
        : undefined,
    stats: defaultStats(args.stats),
    metadata: args.metadata,
    createdAt: now,
    updatedAt: now,
  }
  const inserted = await ctx.db.insert('workflowArtifacts', row)
  return await getArtifact(ctx, inserted)
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
      return row
    }),
  )
  return results.filter(Boolean)
}

export const listAll = query({
  args: {},
  handler: async (ctx) => await listAllArtifacts(ctx),
})

export const listByWorkflowInternal = internalQuery({
  args: { workflowId: v.id('workflows') },
  handler: async (ctx, args) => await listArtifactsByWorkflow(ctx, args.workflowId),
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
    localArtifactPath: v.optional(v.string()),
    localArtifactDeletedAt: v.optional(v.number()),
    imported: v.optional(v.boolean()),
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

export const remove = mutation({
  args: { id: v.id('workflowArtifacts') },
  handler: async (ctx, args) => {
    const existing = await getArtifact(ctx, args.id)
    if (!existing) throw new DomainError('NOT_FOUND', 'Artifact not found')

    await ctx.db.delete(args.id)
    return existing
  },
})

