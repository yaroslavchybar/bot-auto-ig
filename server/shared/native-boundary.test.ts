import { test, expect } from 'bun:test'
import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { nativeFixture } from './native-fixture.testing.js'

test('public content, chat, displays, and automation status work without a Bun command server', async () => {
  let archived = false
  const convex = createServer((request, response) => {
    expect(request.headers.authorization).toBe('Bearer fixture-key')
    const route = new URL(request.url!, 'http://local').pathname
    response.setHeader('Content-Type', 'application/json')
    if (route === '/api/lists') response.end(JSON.stringify([{ id: 'model-1' }]))
    else if (route === '/api/profiles/by-id')
      response.end(JSON.stringify({ id: 'p', name: 'test', igLoggedIn: true }))
    else if (route === '/api/chat/session') response.end(JSON.stringify({ connected: false }))
    else if (route === '/api/chat/archives') {
      if (request.method === 'POST') {
        let body = ''
        request.on('data', (chunk) => {
          body += chunk
        })
        request.on('end', () => {
          const data = JSON.parse(body)
          expect(data).toMatchObject({ profileId: 'p', threadId: '123' })
          archived = data.archived
          response.end(JSON.stringify(archived ? [{ profileId: 'p', threadId: '123' }] : []))
        })
      } else response.end(JSON.stringify(archived ? [{ profileId: 'p', threadId: '123' }] : []))
    } else {
      response.statusCode = 404
      response.end('{}')
    }
  })
  await new Promise<void>((resolve) => convex.listen(0, '127.0.0.1', resolve))
  const bridge = 'http://127.0.0.1:' + (convex.address() as { port: number }).port
  const native = await nativeFixture({ CONVEX_URL: bridge })
  const bank = '/api/ig-accounts/models/model-1/content'
  const get = (route: string) => fetch(native.publicUrl + route)
  try {
    expect(
      (
        await fetch(native.url + '/content/list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(401)
    const original = await sharp({
      create: { width: 1600, height: 1000, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer()
    const upload = await fetch(native.publicUrl + bank + '/posts?name=original.png', {
      method: 'POST',
      body: original,
    })
    expect(upload.status).toBe(200)
    const item = (await upload.json()) as { id: string; variantCount: number }
    expect(item.variantCount).toBe(0)
    const listing = (await (await get(bank)).json()) as Array<{
      id: string
      name: string
      variantCount: number
    }>
    expect(listing[0]).toMatchObject({ id: item.id, name: 'original.png', variantCount: 0 })
    const image = bank + '/posts/' + item.id + '/image'
    expect(Buffer.from(await (await get(image)).arrayBuffer())).toEqual(original)
    const preview = await get(image + '?thumbnail=1')
    expect(preview.headers.get('content-type')).toBe('image/webp')
    expect((await sharp(Buffer.from(await preview.arrayBuffer())).metadata()).width).toBe(512)
    const directory = path.join(native.root, 'data/model-content/model-1')
    const manifest = path.join(directory, 'manifest.json')
    const rows = JSON.parse(await fs.readFile(manifest, 'utf8'))
    rows[0].variants = ['one.jpg', 'two.jpg']
    await fs.writeFile(manifest, JSON.stringify(rows))
    const variants = path.join(directory, 'posts', item.id, 'variants')
    await fs.mkdir(variants, { recursive: true })
    const copy = await sharp(original).jpeg().toBuffer()
    await fs.writeFile(path.join(variants, 'one.jpg'), copy)
    await fs.writeFile(path.join(variants, 'two.jpg'), copy)
    const allocate = async (profileId: string) =>
      (
        await fetch(native.url + '/content/allocate', {
          method: 'POST',
          headers: native.headers,
          body: JSON.stringify({ modelId: 'model-1', kind: 'posts', profileId, excludeIds: [] }),
        })
      ).json() as Promise<{ sourceId: string; path: string }>
    const [a, b] = await Promise.all([allocate('one'), allocate('two')])
    expect(a.sourceId).toBe(item.id)
    expect(a.path).not.toBe(b.path)
    expect(await allocate('one')).toEqual(a)
    const streamed = await get(bank + '/posts/' + item.id + '/copies/one.jpg/image')
    expect(Buffer.from(await streamed.arrayBuffer())).toEqual(copy)
    expect(await (await get('/api/chat/p/session')).json()).toEqual({ connected: false })
    expect((await get('/api/chat/p/threads')).status).toBe(400)
    expect((await get('/api/chat/p/threads/invalid')).status).toBe(400)
    expect((await get('/api/chat/p/avatars/invalid/image')).status).toBe(400)
    const missingPicture = await get('/api/chat/p/avatars/42/image')
    expect(missingPicture.status).toBe(404)
    expect(await missingPicture.json()).toMatchObject({
      error: { message: 'Profile picture unavailable' },
    })
    expect(await (await get('/api/chat/archives')).json()).toEqual([])
    for (const archived of [true, false]) {
      const response = await fetch(native.publicUrl + '/api/chat/p/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: '123', archived }),
      })
      expect(response.status).toBe(200)
      const expected = archived ? [{ profileId: 'p', threadId: '123' }] : []
      expect(await response.json()).toEqual(expected)
      expect(await (await get('/api/chat/archives')).json()).toEqual(expected)
    }
    expect(await (await get('/api/displays')).json()).toEqual([])
    expect(await (await get('/api/automations/status')).json()).toMatchObject({
      running: false,
      runningCount: 0,
    })
    expect(
      (await fetch(native.publicUrl + bank + '/posts/' + item.id, { method: 'DELETE' })).status,
    ).toBe(200)
    expect(await (await get(bank)).json()).toEqual([])
  } finally {
    await native.stop()
    await new Promise<void>((resolve, reject) =>
      convex.close((error) => (error ? reject(error) : resolve())),
    )
  }
}, 15_000)
