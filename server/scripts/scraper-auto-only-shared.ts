import dotenv from 'dotenv'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')

dotenv.config({ quiet: true })
dotenv.config({ path: path.resolve(repoRoot, '.env'), quiet: true })
dotenv.config({ path: path.resolve(repoRoot, '.env.local'), quiet: true })

export type LegacyProfileRow = Record<string, unknown> & {
  _id: string
  name?: string
  proxy?: string | null
  sessionId?: string | null
  dailyScrapingLimit?: number | null
  dailyScrapingUsed?: number | null
}

export type LegacyTaskRow = Record<string, unknown> & {
  _id: string
  name?: string
  status?: string | null
  lastOutput?: unknown
}

export type CohortAnalysis = {
  profileCleanupIds: string[]
  taskLegacyFieldIds: string[]
  taskResetIds: string[]
  taskRuntimeCleanupIds: string[]
  unknownLastOutputShapeIds: string[]
  eligibleProfilesAfter: string[]
}

export type SnapshotPayload = {
  ts_utc: string
  issue: number
  kind: 'scraper-auto-only-pre-apply-snapshot'
  profiles: Array<{
    _id: string
    name?: string
    automation?: boolean | null
    hadAutomation: boolean
  }>
  tasks: LegacyTaskRow[]
}

const LEGACY_LAST_OUTPUT_KEYS = ['mode', 'distribution', 'profileId', 'limit'] as const
const LEGACY_RESUME_KEYS = ['mode', 'distribution', 'profileId', 'limit'] as const

function hasOwn(doc: unknown, key: string): boolean {
  return typeof doc === 'object' && doc !== null && Object.prototype.hasOwnProperty.call(doc, key)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function utcTimestamp(): string {
  return new Date().toISOString()
}

export function defaultEvidencePath(prefix: string): string {
  const safe = utcTimestamp().replace(/[:.]/g, '-')
  return path.resolve(process.cwd(), `../data/migrations/${prefix}-${safe}.json`)
}

export function resolveOutputPath(inputPath: string | undefined, fallbackPrefix: string): string {
  if (inputPath && inputPath.trim()) {
    return path.resolve(process.cwd(), inputPath)
  }
  return defaultEvidencePath(fallbackPrefix)
}

export async function ensureParentDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureParentDir(filePath)
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

export async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw) as T
}

function getConvexUrl(): string {
  const url = process.env.CONVEX_URL
  if (!url) {
    throw new Error('CONVEX_URL is required')
  }
  return url
}

function getConvexSiteUrl(): string {
  return getConvexUrl().replace('.convex.cloud', '.convex.site')
}

function getInternalApiKey(): string {
  const token = process.env.INTERNAL_API_KEY?.trim()
  if (!token) {
    throw new Error('INTERNAL_API_KEY is required')
  }
  return token
}

async function convexHttp<T>(kind: 'query' | 'mutation', pathName: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${getConvexUrl()}/api/${kind}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      path: pathName,
      args,
      format: 'json',
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Convex ${kind} ${pathName} failed with ${response.status}: ${text}`)
  }

  const payload = await response.json() as {
    status?: string
    value?: T
    errorMessage?: string
  }

  if (payload.status === 'error') {
    throw new Error(payload.errorMessage || `Convex ${kind} ${pathName} failed`)
  }

  return payload.value as T
}

async function convexInternalHttp<T>(
  endpoint: string,
  options: {
    method?: 'GET' | 'POST'
    body?: Record<string, unknown>
  } = {},
): Promise<T> {
  const response = await fetch(`${getConvexSiteUrl()}${endpoint}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getInternalApiKey()}`,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Convex internal route ${endpoint} failed with ${response.status}: ${text}`)
  }

  return response.json() as Promise<T>
}

export async function convexQuery<T>(pathName: string, args: Record<string, unknown> = {}): Promise<T> {
  return convexHttp<T>('query', pathName, args)
}

export async function convexMutation<T>(pathName: string, args: Record<string, unknown> = {}): Promise<T> {
  switch (pathName) {
    case 'migrations:scraperAutoOnlyApplyProfileCleanup':
      return convexInternalHttp<T>('/api/migrations/scraper-auto-only/apply-profile-cleanup', {
        method: 'POST',
        body: args,
      })
    case 'migrations:scraperAutoOnlyApplyTaskCleanup':
      return convexInternalHttp<T>('/api/migrations/scraper-auto-only/apply-task-cleanup', {
        method: 'POST',
        body: args,
      })
    case 'migrations:scraperAutoOnlyRollbackProfile':
      return convexInternalHttp<T>('/api/migrations/scraper-auto-only/rollback-profile', {
        method: 'POST',
        body: args,
      })
    case 'migrations:scraperAutoOnlyRollbackTask':
      return convexInternalHttp<T>('/api/migrations/scraper-auto-only/rollback-task', {
        method: 'POST',
        body: args,
      })
    default:
      break
  }

  return convexHttp<T>('mutation', pathName, args)
}

export async function fetchProfiles(): Promise<LegacyProfileRow[]> {
  return convexInternalHttp<LegacyProfileRow[]>('/api/profiles')
}

export async function fetchTasks(): Promise<LegacyTaskRow[]> {
  return convexInternalHttp<LegacyTaskRow[]>('/api/scraping-tasks')
}

function hasLegacyRuntimeState(lastOutput: unknown): { legacy: boolean; unknownShape: boolean } {
  if (typeof lastOutput === 'undefined' || lastOutput === null) {
    return { legacy: false, unknownShape: false }
  }

  if (!isRecord(lastOutput)) {
    return { legacy: false, unknownShape: true }
  }

  for (const key of LEGACY_LAST_OUTPUT_KEYS) {
    if (hasOwn(lastOutput, key)) {
      return { legacy: true, unknownShape: false }
    }
  }

  if (!hasOwn(lastOutput, 'resumeState')) {
    return { legacy: false, unknownShape: false }
  }

  const resumeState = lastOutput.resumeState
  if (resumeState === null || typeof resumeState === 'undefined') {
    return { legacy: false, unknownShape: false }
  }

  if (!isRecord(resumeState)) {
    return { legacy: true, unknownShape: true }
  }

  const legacyResume = LEGACY_RESUME_KEYS.some((key) => hasOwn(resumeState, key))
  return { legacy: legacyResume, unknownShape: false }
}

function hasRemainingCapacity(profile: LegacyProfileRow): boolean {
  const limit = typeof profile.dailyScrapingLimit === 'number' ? profile.dailyScrapingLimit : null
  const used = typeof profile.dailyScrapingUsed === 'number' ? profile.dailyScrapingUsed : 0
  if (limit === null) {
    return true
  }
  return used < limit
}

function isEligibleProfile(profile: LegacyProfileRow): boolean {
  const proxy = typeof profile.proxy === 'string' ? profile.proxy.trim() : ''
  const sessionId = typeof profile.sessionId === 'string' ? profile.sessionId.trim() : ''
  return Boolean(proxy) && Boolean(sessionId) && hasRemainingCapacity(profile)
}

export function analyzeCohorts(profiles: LegacyProfileRow[], tasks: LegacyTaskRow[]): CohortAnalysis {
  const profileCleanupIds = profiles.filter((profile) => hasOwn(profile, 'automation')).map((profile) => profile._id)
  const taskLegacyFieldIds = tasks
    .filter((task) => hasOwn(task, 'mode') || hasOwn(task, 'profileId') || hasOwn(task, 'limit'))
    .map((task) => task._id)
  const taskResetIds = tasks
    .filter((task) => {
      const status = String(task.status ?? '').toLowerCase()
      return status === 'running' || status === 'paused'
    })
    .map((task) => task._id)
  const taskRuntime = tasks.map((task) => ({
    taskId: task._id,
    analysis: hasLegacyRuntimeState(task.lastOutput),
  }))
  const taskRuntimeCleanupIds = taskRuntime.filter((entry) => entry.analysis.legacy).map((entry) => entry.taskId)
  const unknownLastOutputShapeIds = taskRuntime.filter((entry) => entry.analysis.unknownShape).map((entry) => entry.taskId)
  const eligibleProfilesAfter = profiles.filter(isEligibleProfile).map((profile) => profile._id)

  return {
    profileCleanupIds,
    taskLegacyFieldIds,
    taskResetIds,
    taskRuntimeCleanupIds,
    unknownLastOutputShapeIds,
    eligibleProfilesAfter,
  }
}

export function buildSnapshot(profiles: LegacyProfileRow[], tasks: LegacyTaskRow[], analysis: CohortAnalysis): SnapshotPayload {
  const taskIds = new Set([
    ...analysis.taskLegacyFieldIds,
    ...analysis.taskResetIds,
    ...analysis.taskRuntimeCleanupIds,
  ])

  return {
    ts_utc: utcTimestamp(),
    issue: 9,
    kind: 'scraper-auto-only-pre-apply-snapshot',
    profiles: profiles
      .filter((profile) => analysis.profileCleanupIds.includes(profile._id))
      .map((profile) => ({
        _id: profile._id,
        name: typeof profile.name === 'string' ? profile.name : undefined,
        automation: typeof profile.automation === 'boolean' ? profile.automation : null,
        hadAutomation: hasOwn(profile, 'automation'),
      })),
    tasks: tasks.filter((task) => taskIds.has(task._id)),
  }
}

export function sampleIds(ids: string[], sampleLimit: number): string[] {
  return ids.slice(0, Math.max(0, sampleLimit))
}

export function parseCliArgs(argv: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      continue
    }
    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      parsed[key] = true
      continue
    }
    parsed[key] = next
    index += 1
  }
  return parsed
}

export function getSampleLimit(args: Record<string, string | boolean>): number {
  const raw = typeof args.sample === 'string' ? Number(args.sample) : 20
  if (!Number.isFinite(raw)) {
    return 20
  }
  return Math.max(1, Math.min(50, Math.floor(raw)))
}
