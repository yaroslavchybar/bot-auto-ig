import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { BrowserContext } from 'playwright-core'

export const DOM_INSPECTOR_FILE = 'dom-inspector.json'

/** Read-only DOM access for a live browser. The port is reachable only inside
 * the browser's container; its number lives in the open profile directory. */
export async function startDomInspector(context: BrowserContext, profileDir: string): Promise<{
  port: number
  close: () => Promise<void>
}> {
  const infoPath = path.join(profileDir, DOM_INSPECTOR_FILE)
  fs.rmSync(infoPath, { force: true })
  let port = 0
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (req.headers.host !== `127.0.0.1:${port}` || req.headers.origin) {
      res.writeHead(403).end()
      return
    }
    if (req.method !== 'GET') {
      res.writeHead(405).end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    try {
      const pages = context.pages()
      if (url.pathname === '/pages') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(pages.map((page, index) => ({ index, url: page.url() }))))
        return
      }
      if (url.pathname !== '/dom' && url.pathname !== '/aria') {
        res.writeHead(404).end()
        return
      }
      const rawIndex = url.searchParams.get('index') ?? '0'
      const index = /^\d+$/.test(rawIndex) ? Number(rawIndex) : NaN
      const page = pages[index]
      if (!page) {
        res.writeHead(404).end()
        return
      }
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end(url.pathname === '/aria' ? await page.ariaSnapshot() : await page.content())
    } catch {
      res.writeHead(503).end('Browser page unavailable')
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port
      server.off('error', reject)
      resolve()
    })
  })
  let closing: Promise<void> | undefined
  const close = () => (closing ??= (async () => {
    try {
      fs.rmSync(infoPath, { force: true })
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })())
  try {
    fs.writeFileSync(infoPath, JSON.stringify({ pid: process.pid, port }), { mode: 0o600 })
  } catch (error) {
    await close()
    throw error
  }
  return { port, close }
}
