import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer, request } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { chromium, type BrowserContext } from 'playwright-core'
import { startFilePicker, pickerSocket, parseManifest, MAX_UPLOAD_BYTES } from '../browser/filePicker.js'
import router from './filePicker.js'
import { activeDisplays, automationWorkers } from '../shared/store.js'

function payload(contents = Buffer.from([0, 255, 1, 128]), name = 'фото.png') {
  const metadata = Buffer.from(JSON.stringify([{ name, type: 'image/png', size: contents.length }]))
  const header = Buffer.alloc(4)
  header.writeUInt32BE(metadata.length)
  return Buffer.concat([header, metadata, contents])
}

test('file metadata rejects paths, oversized buffers, and multiple files for a single input', () => {
  const file = { name: 'test', type: '', size: 0 }
  assert.throws(() => parseManifest(JSON.stringify([{ ...file, name: '../secret' }]), true))
  assert.throws(() => parseManifest(JSON.stringify([{ ...file, size: MAX_UPLOAD_BYTES }]), true))
  assert.throws(() => parseManifest(JSON.stringify([file, file]), false))
  assert.throws(() => parseManifest(JSON.stringify([{ ...file, size: -1 }]), true))
})

// Bun's Windows HTTP server cannot listen on named pipes. Run this suite through
// `bun build --target=node --packages=external` and `node --test` on Windows.
const unsupportedPipe = process.platform === 'win32' && Boolean(process.versions.bun)
test('display upload proxy passes bytes in memory, rejects stale requests and agent control', { skip: unsupportedPipe }, async () => {
  const port = 62001
  const page = Object.assign(new EventEmitter(), { isClosed: () => false, mainFrame: () => 'main' })
  const context = Object.assign(new EventEmitter(), { pages: () => [page] })
  const stop = await startFilePicker(context as unknown as BrowserContext, pickerSocket(port))
  const app = express()
  app.use(router)
  const server = createServer(app).listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/${port}/file-picker`
  activeDisplays.set('picker-test', { vncPort: port, automationId: 'picker-test', profileName: 'test', displayNum: 100, status: 'active' })
  let attached: Array<{ name: string; mimeType: string; buffer: Buffer }> = []
  const choose = () => page.emit('filechooser', {
    page: () => page, isMultiple: () => false,
    setFiles: async (files: typeof attached) => { attached = files },
  })
  try {
    assert.equal(await (await fetch(base)).json(), null)
    const waiting = fetch(`${base}?wait=1`)
    await new Promise(resolve => setTimeout(resolve, 20))
    choose()
    assert.ok((await (await waiting).json() as { id: string }).id)
    const first = await (await fetch(base)).json() as { id: string }
    choose()
    assert.equal((await fetch(`${base}?id=${first.id}`, { method: 'POST', body: payload() })).status, 409)
    const current = await (await fetch(base)).json() as { id: string }
    automationWorkers.set('picker-test', {} as never)
    assert.equal((await fetch(`${base}?id=${current.id}`, { method: 'POST', body: payload() })).status, 409)
    assert.equal(attached.length, 0)
    automationWorkers.delete('picker-test')
    assert.equal((await fetch(`${base}?id=${current.id}`, { method: 'POST', body: payload() })).status, 200)
    assert.equal(attached[0].name, 'фото.png')
    assert.deepEqual(attached[0].buffer, Buffer.from([0, 255, 1, 128]))
    assert.equal(await (await fetch(base)).json(), null)
    choose()
    const cancelled = await (await fetch(base)).json() as { id: string }
    assert.equal((await fetch(`${base}?id=${cancelled.id}`, { method: 'DELETE' })).status, 200)
    assert.equal((await fetch(`${base}?id=${cancelled.id}`, { method: 'POST', body: payload() })).status, 409)
    choose()
    page.emit('framenavigated', 'main')
    assert.equal(await (await fetch(base)).json(), null)
    choose()
    const malformed = await (await fetch(base)).json() as { id: string }
    assert.equal((await fetch(`${base}?id=${malformed.id}`, { method: 'POST', body: payload().subarray(0, 7) })).status, 400)
  } finally {
    automationWorkers.delete('picker-test')
    activeDisplays.delete('picker-test')
    server.closeAllConnections()
    server.close()
    stop()
  }
})

test('real Chromium receives local file bytes and emits the website change event', { skip: unsupportedPipe || !process.env.RUN_BROWSER_TESTS }, async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const context = await browser.newContext()
  const page = await context.newPage()
  let received!: (bytes: Buffer) => void
  const uploaded = new Promise<Buffer>(resolve => { received = resolve })
  const site = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    received(Buffer.concat(chunks))
    res.end('uploaded')
  }).listen(0, '127.0.0.1')
  await new Promise<void>(resolve => site.once('listening', resolve))
  const endpoint = pickerSocket(62002)
  const stop = await startFilePicker(context, endpoint)
  const call = (method: string, url = '/', body?: Buffer) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ socketPath: endpoint, method, path: url }, res => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.end(body)
  })
  try {
    const action = `http://127.0.0.1:${(site.address() as AddressInfo).port}`
    await page.setContent(`<form action="${action}" method="post" enctype="multipart/form-data"><input name="file" type="file" onchange="this.dataset.changed = true"></form>`)
    const chooser = page.waitForEvent('filechooser')
    await page.locator('input').click()
    await chooser
    const pending = JSON.parse((await call('GET')).body) as { id: string }
    assert.equal((await call('POST', `/?id=${pending.id}`, payload())).status, 200)
    const result = await page.locator('input').evaluate(async (element: HTMLInputElement) => ({
      name: element.files![0].name,
      bytes: Array.from(new Uint8Array(await element.files![0].arrayBuffer())),
      changed: element.dataset.changed,
    }))
    assert.deepEqual(result, { name: 'фото.png', bytes: [0, 255, 1, 128], changed: 'true' })
    await page.locator('form').evaluate((form: HTMLFormElement) => form.submit())
    assert.ok((await uploaded).includes(Buffer.from([0, 255, 1, 128])), 'site receives the selected binary content')
  } finally { stop(); site.closeAllConnections(); site.close(); await browser.close() }
})
