import {
  makeFunctionReference,
  type GenericDataModel,
  type GenericMutationCtx,
} from 'convex/server'
import type { GenericId, Value } from 'convex/values'

type Context = Pick<GenericMutationCtx<GenericDataModel>, 'db' | 'scheduler'>
type Row = Record<string, Value | undefined>
const renames: Record<string, Record<string, string>> = {
  accountProgress: {
    followIncrease: 'outreachIncrease',
    followQuotaDate: 'outreachQuotaDate',
    used: 'outreachUsedToday',
    allowance: 'outreachAllowanceToday',
    dmDate: 'dmCountDate',
  },
  profiles: {
    using: 'inUse',
    sessionId: 'instagramSessionId',
    renameFrom: 'pendingRenameFrom',
    listIds: 'modelIds',
  },
  scraperProfiles: { using: 'inUse', renameFrom: 'pendingRenameFrom' },
  automations: { listIds: 'modelIds' },
  leads: {
    enrichmentStatus: 'screeningStatus',
    enrichedAt: 'screenedAt',
    followCheckPassed: 'englishTextCheckPassed',
  },
  models: { fullName: 'baseFullName', fullNames: 'fullNameVariations' },
  modelSetupStates: { nameDone: 'usernameDone' },
  leadStats: {
    revision: 'dataRevision',
    scanRevision: 'backfillRevision',
    complete: 'backfillComplete',
    cursor: 'backfillCursor',
    jobId: 'backfillJobId',
  },
  scrapeSources: { discovered: 'leadsAdded', lastCheckAt: 'lastPostsCheckAt', kind: 'runKind' },
}

export const retiredFields: Record<string, string[]> = {
  accountProgress: [
    'dmIncrease',
    'lastNotificationsDate',
    'lastNotificationsAt',
    'outreachDays',
    'outreachStartedAt',
    'date',
    'startedAt',
  ],
  profiles: ['mode', 'scraperDailyLimit', 'scraperUsageDate', 'scraperUsageCount'],
  scraperProfiles: ['scraperDailyLimit', 'scraperUsageDate', 'scraperUsageCount'],
  leadLists: ['scrapeIncludePrivate', 'scrapeMonitorDays'],
  leads: ['enrichmentModel', 'enrichmentConfidence'],
  automations: ['retryCount', 'maxRetries'],
  modelSetupStates: ['avatarSourceId'],
  warmupStates: ['updatedAt', 'lastRunAt', 'followBlockReason'],
  scrapeSources: ['postsFromApify'],
  scrapePosts: ['observedLikeCount', 'monitorEligible', 'checks'],
}

export const cleanupTables = [
  'lists',
  'models',
  'profileListAssignments',
  'profiles',
  'scraperProfiles',
  'automations',
  'accountProgress',
  'leads',
  'modelSetupStates',
  'modelSetupGroupNames',
  'modelContentCleanup',
  'leadLists',
  'leadStats',
  'analyticsDays',
  'analyticsHistory',
  'scrapeSources',
  'scrapePosts',
  'scraperRequestUsage',
  'warmupStates',
  'messageTemplates',
  'retiredLists',
  'schemaCleanupModels',
]

/** Accept old and new row shapes only during a deployment with all app handlers blocked. */
export function compatibilitySchema(source: string) {
  let position = 0
  while ((position = source.indexOf('defineTable(', position)) >= 0) {
    const start = position + 'defineTable('.length
    let depth = 1,
      end = start,
      quote = ''
    for (; end < source.length && depth; end++) {
      const char = source[end]!
      if (quote) {
        if (char === '\\') end++
        else if (char === quote) quote = ''
        continue
      }
      if (source.startsWith('//', end)) {
        const newline = source.indexOf('\n', end)
        end = newline < 0 ? source.length : newline
        continue
      }
      if (source.startsWith('/*', end)) {
        const close = source.indexOf('*/', end + 2)
        if (close < 0) throw new Error('Unclosed schema comment')
        end = close + 1
        continue
      }
      if (char === '"' || char === "'" || char === '`') {
        quote = char
        continue
      }
      if (char === '(') depth++
      if (char === ')') depth--
    }
    if (depth) throw new Error('Unclosed table validator')
    source = source.slice(0, start) + 'v.any()' + source.slice(end - 1)
    position = start + 'v.any())'.length
  }
  return source.replace(
    'export default defineSchema({',
    `export default defineSchema({
  lists: defineTable(v.any()),
  profileListAssignments: defineTable(v.any()),
  messageTemplates: defineTable(v.any()),
  schemaCleanupState: defineTable(v.any()),
  schemaCleanupModels: defineTable(v.any()).index('by_old', ['oldId']),`,
  )
}

function rename(row: Row, fields: Record<string, string>) {
  for (const [old, current] of Object.entries(fields)) {
    if (row[current] === undefined && row[old] !== undefined) row[current] = row[old]
    delete row[old]
  }
}
function record(value: unknown): value is Record<string, Value> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof ArrayBuffer)
  )
}
function references(
  value: Value | undefined,
  mapping: Map<string, string>,
  key = '',
): Value | undefined {
  if (key === 'contentKey') return value
  if (typeof value === 'string') return mapping.get(value) ?? value
  if (Array.isArray(value)) return value.map((item) => references(item, mapping) as Value)
  if (record(value)) {
    const next: Record<string, Value> = {}
    for (const [field, item] of Object.entries(value)) {
      if (field === 'listIds' && value.modelIds !== undefined) continue
      next[field === 'listIds' ? 'modelIds' : (mapping.get(field) ?? field)] = references(
        item,
        mapping,
        field,
      ) as Value
    }
    return next
  }
  return value
}
function removeNested(row: Row, field: string, names: string[]) {
  if (!record(row[field])) return
  const next = { ...row[field] }
  for (const name of names) delete next[name]
  row[field] = next
}

/** Pages are transactional; the journal makes interrupted table copies resumable. */
export async function cleanupBatch(
  ctx: Context,
  { table, cursor }: { table: string; cursor: string | null },
) {
  if (!cleanupTables.includes(table)) throw new Error('Unexpected cleanup table')
  if (table === 'lists' && !(await ctx.db.query('schemaCleanupState').first()))
    await ctx.db.insert('schemaCleanupState', { key: 'cleanup-v2' })
  const actual = table === 'retiredLists' ? 'lists' : table
  const page = await ctx.db
    .query(actual)
    .paginate({ cursor, numItems: 100, maximumBytesRead: 1_000_000 })
  const journal = await ctx.db.query('schemaCleanupModels').collect()
  const mapping = new Map(journal.map((row) => [String(row.oldId), String(row.modelId)]))
  for (const row of page.page) {
    const id = row._id as GenericId<string>
    const { _id, _creationTime: _time, ...data } = row
    if (
      table === 'messageTemplates' ||
      table === 'retiredLists' ||
      table === 'schemaCleanupModels'
    ) {
      await ctx.db.delete(id)
      continue
    }
    if (table === 'lists') {
      if (mapping.has(String(id))) continue
      rename(data, renames.models!)
      data.contentKey ??= String(id)
      const modelId = await ctx.db.insert('models', data)
      await ctx.db.insert('schemaCleanupModels', { oldId: String(id), modelId })
      mapping.set(String(id), String(modelId))
      continue
    }
    if (table === 'profileListAssignments') {
      const modelId = mapping.get(String(data.listId))
      if (modelId && (await ctx.db.get(data.profileId as GenericId<'profiles'>))) {
        const existing = await ctx.db
          .query('profileModelAssignments')
          .withIndex('by_profile', (q) => q.eq('profileId', data.profileId!))
          .filter((q) => q.eq(q.field('modelId'), modelId))
          .first()
        if (!existing)
          await ctx.db.insert('profileModelAssignments', { profileId: data.profileId, modelId })
      }
      await ctx.db.delete(id)
      continue
    }
    if (table === 'modelContentCleanup') {
      data.contentKey ??= String(data.modelId)
      delete data.modelId
    }
    if (
      table === 'scrapePosts' &&
      data.firstScrapedAt === undefined &&
      typeof data.lastScrapedAt === 'number'
    ) {
      const times = Array.isArray(data.checks)
        ? data.checks
            .filter(record)
            .filter((check) => typeof check.at === 'number' && typeof check.elapsedMs === 'number')
            .map((check) => Number(check.at) - Number(check.elapsedMs))
        : []
      data.firstScrapedAt = Math.min(data.lastScrapedAt, ...times)
    }
    rename(data, renames[table] ?? {})
    for (const field of retiredFields[table] ?? []) delete data[field]
    if (table === 'models') data.contentKey ??= String(id)
    if (table === 'modelSetupStates' && record(data.pending) && data.pending.kind === 'name')
      data.pending = { ...data.pending, kind: 'username' }
    if (table === 'analyticsDays' || table === 'analyticsHistory')
      removeNested(data, table === 'analyticsDays' ? 'counts' : 'totals', [
        'scraperUnits',
        'unlimitedScraperUnits',
      ])
    if (table === 'leadStats') removeNested(data, 'counts', ['pending', 'enriched', 'ready'])
    if (table === 'scraperRequestUsage' && Array.isArray(data.requests))
      data.requests = data.requests.map((item) => {
        if (!record(item)) return item
        const next = { ...item }
        rename(next, { at: 'reservedAt' })
        return next as Value
      })
    const next = references(data as Value, mapping) as Record<string, Value>
    if (
      ['modelSetupStates', 'modelSetupGroupNames'].includes(table) &&
      typeof next.modelId === 'string' &&
      !ctx.db.normalizeId('models', next.modelId)
    ) {
      await ctx.db.delete(id)
      continue
    }
    if (Array.isArray(next.modelIds))
      next.modelIds = next.modelIds.filter(
        (value) => typeof value === 'string' && ctx.db.normalizeId('models', value) !== null,
      )
    await ctx.db.replace(id, next)
  }
  return { done: page.isDone, cursor: page.continueCursor }
}

/** Re-create expiry jobs after activating the normal handlers, including jobs blocked by maintenance. */
export async function rescheduleExpiry(ctx: Context, { cursor }: { cursor: string | null }) {
  const page = await ctx.db
    .query('scrapePosts')
    .paginate({ cursor, numItems: 100, maximumBytesRead: 1_000_000 })
  for (const post of page.page) {
    const first = post.firstScrapedAt ?? post.lastScrapedAt
    if (typeof first === 'number')
      await ctx.scheduler.runAt(
        Math.max(Date.now(), first + 86_400_000),
        makeFunctionReference<'mutation'>('scrapeSources:expirePost'),
        { postId: post._id, firstScrapedAt: first },
      )
  }
  if (page.isDone)
    for (const row of await ctx.db.query('schemaCleanupState').collect())
      await ctx.db.delete(row._id as GenericId<string>)
  return { done: page.isDone, cursor: page.continueCursor }
}

// Bypass the maintenance registration facade; these are internal admin-only functions.
export const migrationModule = `import { v } from 'convex/values'
import { internalMutationGeneric } from 'convex/server'
import { cleanupBatch, rescheduleExpiry } from '../.github/scripts/schema-cleanup'
export const batch = internalMutationGeneric({ args: { table: v.string(), cursor: v.union(v.string(), v.null()) }, handler: cleanupBatch })
export const expiry = internalMutationGeneric({ args: { cursor: v.union(v.string(), v.null()) }, handler: rescheduleExpiry })
`

export const maintenanceModule = `import { queryGeneric, internalQueryGeneric, mutationGeneric, internalMutationGeneric, actionGeneric, internalActionGeneric, httpActionGeneric } from 'convex/server'
const unavailable = async () => { throw new Error('Database migration in progress; retry shortly') }
const blocked = register => () => register({ handler: unavailable })
export const query = blocked(queryGeneric)
export const internalQuery = blocked(internalQueryGeneric)
export const mutation = blocked(mutationGeneric)
export const internalMutation = blocked(internalMutationGeneric)
export const action = blocked(actionGeneric)
export const internalAction = blocked(internalActionGeneric)
export const httpAction = () => httpActionGeneric(unavailable)
`
