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

/** Uploaded originals enter the bank immediately; copies are generated on demand. */
export async function addContent(modelId: string, kind: ContentKind, name: string, bytes: Buffer) {
  if (!['posts', 'avatars'].includes(kind)) throw new Error('Invalid content type')
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error('Image must be 1–15 MB')
  const extension = path.extname(name).toLowerCase()
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) throw new Error('Upload a JPG, PNG, or WebP image')
  const id = randomUUID()
  const dir = path.join(modelDir(modelId), kind, id)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, `source${extension}`), bytes, { mode: 0o600 })
  try {
    await locked(modelId, async () => {
      const rows = await read(modelId)
      rows.push({ id, kind, name: path.basename(name), variants: [], assigned: {}, createdAt: Date.now() })
      await write(modelId, rows)
    })
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true })
    throw error
  }
  return { id, variantCount: 0 }
}

/** Content IDs with a spoofer run in flight. The lock only serializes manifest access. */
const generating = new Set<string>()

/** Generate the 50 unique variants for a stored original. Kind must match. */
export async function generateCopies(modelId: string, kind: ContentKind, contentId: string) {
  const key = `${modelId}:${contentId}`
  if (generating.has(key)) throw new Error('Copy generation already running')
  generating.add(key)
  try {
    const source = await locked(modelId, async () => {
      const row = (await read(modelId)).find(item => item.id === contentId && item.kind === kind)
      if (!row) throw new Error('Image not found')
      if (row.variants.length) throw new Error('Copies already exist')
      const extension = path.extname(row.name).toLowerCase()
      return { file: path.join(modelDir(modelId), row.kind, row.id, `source${extension}`),
        kind: row.kind, id: row.id }
    })
    const variantsDir = path.join(modelDir(modelId), source.kind, source.id, 'variants')
    try {
      const result = await runSpoofer(source.file)
      const variants = [...new Set((result.outputs ?? []).map(item => item.name ?? '')
        .filter(item => /^[^/\\]+\.jpg$/i.test(item)))]
      if (variants.length !== 50 || result.failures?.length)
        throw new Error(`Spoofer produced ${variants.length}/50 variants`)
      return await locked(modelId, async () => {
        const rows = await read(modelId)
        const row = rows.find(item => item.id === contentId)
        if (!row) throw new Error('Image not found')
        if (row.variants.length) throw new Error('Copies already exist')
        row.variants = variants
        await write(modelId, rows)
        return { id: contentId, variantCount: variants.length }
      })
    } catch (error) {
      // Every failure after the spoofer starts must not leave partial output behind.
      await fs.rm(variantsDir, { recursive: true, force: true })
      throw error
    }
  } finally {
    generating.delete(key)
  }
}

/** Remove an original and all its copies from the bank. Kind must match. */
export async function removeContent(modelId: string, kind: ContentKind, contentId: string) {
  return locked(modelId, async () => {
    const rows = await read(modelId)
    const row = rows.find(item => item.id === contentId && item.kind === kind)
    if (!row) throw new Error('Image not found')
    await write(modelId, rows.filter(item => item.id !== contentId))
    await fs.rm(path.join(modelDir(modelId), row.kind, row.id), { recursive: true, force: true })
    return { removed: true }
  })
}

/** Copy names for the viewer. Only rows with generated variants are served. */
export async function listCopies(modelId: string, kind: ContentKind, contentId: string) {
  const row = (await read(modelId)).find(item => item.id === contentId && item.kind === kind)
  if (!row) throw new Error('Image not found')
  return row.variants.filter(item => /^[^/\\]+\.jpg$/i.test(item))
}

/** Serve a single generated copy. The name must belong to this image's manifest row. */
export async function copyImage(modelId: string, kind: ContentKind, contentId: string, variant: string) {
  const row = (await read(modelId)).find(item => item.id === contentId && item.kind === kind)
  if (!row || !row.variants.includes(variant) || !/^[^/\\]+\.jpg$/i.test(variant)) return null
  const bytes = await fs.readFile(path.join(modelDir(modelId), kind, row.id, 'variants', variant))
  return { bytes, type: 'image/jpeg' }
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
