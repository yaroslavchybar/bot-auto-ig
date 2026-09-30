import sharp from 'sharp'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'

sharp.cache({ memory: 16, files: 0, items: 32 })
sharp.concurrency(1)
const pending = new Map<string, Promise<Buffer>>()
let queue: Promise<unknown> = Promise.resolve()

// Immutable sources get one disk-cached preview. Serialize decoding to cap CPU and memory.
export async function thumbnail(source: string): Promise<Buffer> {
  const destination = `${source}.thumbnail.webp`
  try {
    return await fs.readFile(destination)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const existing = pending.get(destination)
  if (existing) return existing
  const work = queue.then(async () => {
    const temporary = `${destination}.${randomUUID()}.tmp`
    try {
      await sharp(source, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 75 })
        .timeout({ seconds: 15 })
        .toFile(temporary)
      await fs.chmod(temporary, 0o600)
      await fs.rename(temporary, destination)
      return await fs.readFile(destination)
    } finally {
      await fs.rm(temporary, { force: true })
    }
  })
  pending.set(destination, work)
  queue = work.catch(() => undefined)
  try {
    return await work
  } finally {
    pending.delete(destination)
  }
}
