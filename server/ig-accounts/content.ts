import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { resolveProjectRoot } from '../shared/utils.js'

const defaultRoot = path.join(resolveProjectRoot(import.meta.url), 'data', 'model-content')
export type ContentKind = 'posts' | 'avatars'
export type ContentItem = { id: string; kind: ContentKind; name: string; variants: string[]; assigned: Record<string, number>; createdAt: number }
const pending = new Map<string, Promise<unknown>>()

/** The spoofer service shares /app/data and owns its own CPU/memory quota. */
async function runSpoofer(source: string): Promise<{ outputs?: Array<{ name?: string }>; failures?: unknown[] }> {
  const response = await fetch(process.env.SPOOFER_URL?.trim() || 'http://spoofer:3002/variants', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }), signal: AbortSignal.timeout(30 * 60_000),
  })
  const result = await response.json() as { outputs?: Array<{ name?: string }>; failures?: unknown[]; error?: string }
  if (!response.ok) throw new Error(result.error || `Spoofer HTTP ${response.status}`)
  return result
}

function modelDir(modelId: string): string {
  if (!/^[a-zA-Z0-9_-]{4,100}$/.test(modelId)) throw new Error('Invalid model ID')
  return path.join(process.env.MODEL_CONTENT_DIR?.trim() || defaultRoot, modelId)
}

async function read(modelId: string): Promise<ContentItem[]> {
  try { return JSON.parse(await fs.readFile(path.join(modelDir(modelId), 'manifest.json'), 'utf8')) as ContentItem[] }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function write(modelId: string, rows: ContentItem[]): Promise<void> {
  const dir = modelDir(modelId)
  await fs.mkdir(dir, { recursive: true })
  const temp = path.join(dir, `manifest.${randomUUID()}.tmp`)
  await fs.writeFile(temp, JSON.stringify(rows), { mode: 0o600 })
  try { await fs.rename(temp, path.join(dir, 'manifest.json')) }
  catch (error) { await fs.rm(temp, { force: true }); throw error }
}

async function locked<T>(modelId: string, work: () => Promise<T>): Promise<T> {
  const previous = pending.get(modelId) ?? Promise.resolve()
  const result = previous.then(work, work)
  pending.set(modelId, result.catch(() => undefined))
  return result
}

export async function listContent(modelId: string) {
  return locked(modelId, async () => (await read(modelId)).map(row => ({
    id: row.id, kind: row.kind, name: row.name,
    variantCount: row.variants.length, usedCount: Object.keys(row.assigned).length,
    createdAt: row.createdAt,
  })))
}

/** Serve only an original recorded in this model's manifest. */
export async function contentImage(modelId: string, kind: ContentKind, contentId: string) {
  const item = (await read(modelId)).find(row => row.id === contentId && row.kind === kind)
  if (!item) return null
  const extension = path.extname(item.name).toLowerCase()
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) return null
  const file = path.join(modelDir(modelId), kind, item.id, `source${extension}`)
  return { bytes: await fs.readFile(file), type: extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg' }
}

/** Uploaded originals produce 50 unique variants before entering the content bank. */
export async function addContent(modelId: string, kind: ContentKind, name: string, bytes: Buffer) {
  if (!['posts', 'avatars'].includes(kind)) throw new Error('Invalid content type')
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error('Image must be 1–15 MB')
  const extension = path.extname(name).toLowerCase()
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) throw new Error('Upload a JPG, PNG, or WebP image')
  const id = randomUUID()
  const dir = path.join(modelDir(modelId), kind, id)
  await fs.mkdir(dir, { recursive: true })
  const source = path.join(dir, `source${extension}`)
  await fs.writeFile(source, bytes, { mode: 0o600 })
  try {
    const result = await runSpoofer(source)
    const variants = (result.outputs ?? []).map(item => item.name ?? '')
      .filter(item => /^[^/\\]+\.jpg$/i.test(item))
    if (variants.length !== 50 || result.failures?.length) throw new Error(`Spoofer produced ${variants.length}/50 variants`)
    await locked(modelId, async () => {
      const rows = await read(modelId)
      rows.push({ id, kind, name: path.basename(name), variants, assigned: {}, createdAt: Date.now() })
      await write(modelId, rows)
    })
    return { id, variantCount: variants.length }
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true })
    throw error
  }
}

/** A variant may be used by one account only, and an account gets one copy per source. */
export async function allocateContent(modelId: string, kind: ContentKind, profileId: string,
  excludeIds: string[] = []): Promise<{ sourceId: string; path: string } | null> {
  return locked(modelId, async () => {
    const rows = await read(modelId)
    const row = rows.find(item => item.kind === kind && !excludeIds.includes(item.id) &&
      (item.assigned[profileId] !== undefined || Object.keys(item.assigned).length < item.variants.length))
    if (!row) return null
    let index = row.assigned[profileId]
    if (index === undefined) {
      const used = new Set(Object.values(row.assigned))
      index = row.variants.findIndex((_, i) => !used.has(i))
      if (index < 0) return null
      row.assigned[profileId] = index
      await write(modelId, rows)
    }
    return { sourceId: row.id, path: path.join(modelDir(modelId), kind, row.id, 'variants', row.variants[index]) }
  })
}

export async function availableSources(modelId: string, kind: ContentKind, profileId: string,
  excludeIds: string[] = []): Promise<number> {
  return locked(modelId, async () => (await read(modelId)).filter(item => item.kind === kind &&
    !excludeIds.includes(item.id) && (item.assigned[profileId] !== undefined ||
      Object.keys(item.assigned).length < item.variants.length)).length)
}
