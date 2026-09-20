import { createServer, type IncomingMessage } from 'node:http'
import { chmodSync, lstatSync, unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import type { BrowserContext, FileChooser, Page } from 'playwright-core'

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
export const pickerSocket = (port: number) => process.platform === 'win32'
  ? `\\\\.\\pipe\\ig-bot-picker-${port}`
  : path.join(os.tmpdir(), `ig-bot-picker-${port}.sock`)

type Pending = { id: string; chooser: FileChooser; expires: number }

// The worker owns the chooser. Only bytes, never filesystem paths, reach Playwright.
export async function startFilePicker(context: BrowserContext, endpoint: string) {
  let pending: Pending | undefined
  let uploading = false
  const waiters = new Set<() => void>()
  const current = () => {
    if (pending && (pending.expires < Date.now() || pending.chooser.page().isClosed())) pending = undefined
    return pending
  }
  const onChooser = (chooser: FileChooser) => {
    pending = { id: randomUUID(), chooser, expires: Date.now() + 5 * 60_000 }
    for (const notify of waiters) notify()
  }
  const pages = new Map<Page, () => void>()
  const attach = (page: Page) => {
    const closed = () => { detach(); pages.delete(page); if (pending?.chooser.page() === page) pending = undefined }
    const navigated = (frame: ReturnType<Page['mainFrame']>) => {
      if (pending?.chooser.page() === page && frame === page.mainFrame()) pending = undefined
    }
    const detach = () => {
      page.off('filechooser', onChooser)
      page.off('close', closed)
      page.off('framenavigated', navigated)
    }
    pages.set(page, detach)
    page.on('filechooser', onChooser)
    page.on('close', closed)
    page.on('framenavigated', navigated)
  }
  const server = createServer(async (req, res) => {
    const reply = (status: number, value: unknown) => {
      if (res.destroyed || res.writableEnded) return
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(value))
    }
    try {
      const url = new URL(req.url || '/', 'http://localhost')
      if (req.method === 'GET') {
        if (!current() && url.searchParams.has('wait')) {
          await new Promise<void>(resolve => {
            const done = () => {
              clearTimeout(timer)
              waiters.delete(done)
              res.off('close', done)
              resolve()
            }
            const timer = setTimeout(done, 20_000)
            waiters.add(done)
            res.once('close', done)
          })
        }
        const selection = current()
        reply(200, selection ? { id: selection.id, multiple: selection.chooser.isMultiple() } : null)
        return
      }
      const selection = current()
      if (!selection || url.searchParams.get('id') !== selection.id) return reply(409, { error: 'File request expired. Click Upload on the site again.' })
      if (req.method === 'DELETE') {
        pending = undefined
        return reply(200, { success: true })
      }
      if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' })
      if (uploading) return reply(409, { error: 'Upload already in progress' })
      uploading = true
      try {
        const payload = await readBytes(req)
        if (payload.length < 4) throw new Error('Missing file metadata')
        const metadataSize = payload.readUInt32BE(0)
        if (metadataSize > 64 * 1024 || metadataSize + 4 > payload.length) throw new Error('Invalid file metadata')
        const files = parseManifest(payload.subarray(4, 4 + metadataSize).toString('utf8'), selection.chooser.isMultiple())
        const expected = files.reduce((sum, file) => sum + file.size, 0)
        const body = payload.subarray(4 + metadataSize)
        if (body.length !== expected) throw new Error('Incomplete upload')
        if (current() !== selection) return reply(409, { error: 'File request expired' })
        let offset = 0
        await selection.chooser.setFiles(files.map(file => {
          const buffer = body.subarray(offset, offset + file.size)
          offset += file.size
          return { name: file.name, mimeType: file.type, buffer }
        }), { timeout: 30_000 })
        if (pending === selection) pending = undefined
        reply(200, { success: true })
      } finally { uploading = false }
    } catch (error) {
      reply(400, { error: error instanceof Error ? error.message : 'Could not attach files' })
    }
  })
  server.requestTimeout = 120_000
  // A crashed worker can leave its socket behind. The caller holds this display's lock.
  if (process.platform !== 'win32') {
    try { if (lstatSync(endpoint).isSocket()) unlinkSync(endpoint) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(endpoint, () => {
      try {
        if (process.platform !== 'win32') chmodSync(endpoint, 0o600)
        resolve()
      } catch (error) { server.close(); reject(error) }
    })
  })
  context.pages().forEach(attach)
  context.on('page', attach)
  return () => {
    pending = undefined
    for (const notify of waiters) notify()
    context.off('page', attach)
    for (const detach of pages.values()) detach()
    pages.clear()
    server.closeAllConnections()
    server.close()
  }
}

export function parseManifest(raw: string | null, multiple: boolean): Array<{ name: string; type: string; size: number }> {
  const files: unknown = JSON.parse(raw || 'null')
  if (!Array.isArray(files) || !files.length || files.length > 20 || (!multiple && files.length > 1)) throw new Error('Invalid file count')
  let total = 0
  for (const file of files) {
    if (!file || typeof file.name !== 'string' || !file.name || file.name.length > 255 || /[\\/\x00-\x1f]/.test(file.name)
      || typeof file.type !== 'string' || file.type.length > 255 || !Number.isSafeInteger(file.size) || file.size < 0) throw new Error('Invalid file metadata')
    total += file.size
  }
  if (total >= MAX_UPLOAD_BYTES) throw new Error('Choose less than 50 MiB of files')
  return files
}

async function readBytes(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_UPLOAD_BYTES + 64 * 1024 + 4) throw new Error('Choose at most 50 MiB of files')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size)
}
