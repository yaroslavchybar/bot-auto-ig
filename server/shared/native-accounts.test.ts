import { test, expect } from 'bun:test'
import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createDecipheriv, createHmac } from 'node:crypto'
import WebSocket from 'ws'
import { Database } from 'bun:sqlite'
import { nativeFixture } from './native-fixture.testing.js'

const credentialKey = 'aa'.repeat(32)

async function fixture() {
  let profile: Record<string, unknown> | null = {
    id: 'p',
    name: 'Old',
    status: 'running',
    using: true,
    cookiesJson: '[]',
    listIds: ['model'],
    igLoggedIn: true,
  }
  const accounts: Array<Record<string, unknown>> = []
  let states: Array<Record<string, any>> = []
  let failFinalize = false
  let failPostSave = false
  let calls: string[] = []
  const convex = createServer(async (req, res) => {
    expect(req.headers.authorization).toBe('Bearer fixture-key')
    const route = new URL(req.url!, 'http://local').pathname
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    res.setHeader('Content-Type', 'application/json')
    const reply = (value: unknown) => res.end(JSON.stringify(value))
    calls.push(route + ':' + (body.operation || req.method))
    if (route === '/api/lists') return reply([{ id: 'model' }])
    if (route === '/api/profiles/by-id' || route === '/api/profiles/by-name') return reply(profile)
    if (route === '/api/profiles' && req.method === 'GET') return reply(profile ? [profile] : [])
    if (route === '/api/profiles/sync-status') {
      profile = { ...profile!, status: body.status, using: body.using }
      return reply({ ok: true })
    }
    if (route === '/api/profiles/update-by-name') {
      profile = { ...profile!, ...body, renameFrom: body.oldName }
      return reply(profile)
    }
    if (route === '/api/profiles/finish-rename') {
      delete profile!.renameFrom
      return reply({ ok: true })
    }
    if (route === '/api/profiles/begin-delete') {
      profile = { ...profile!, status: 'deleting' }
      return reply(profile)
    }
    if (route === '/api/profiles/finish-delete') {
      if (failFinalize) {
        failFinalize = false
        res.statusCode = 500
        return reply({ error: 'offline' })
      }
      profile = null
      return reply({ ok: true })
    }
    if (route === '/api/ig-accounts-store') {
      switch (body.operation) {
        case 'import': {
          let imported = 0
          for (const row of body.rows)
            if (!accounts.some((existing) => existing.usernameHash === row.usernameHash)) {
              accounts.push({
                ...row,
                _id: 'a' + accounts.length,
                createdAt: 1,
                status: 'available',
              })
              imported++
            }
          return reply({ imported })
        }
        case 'list':
          return reply(accounts)
        case 'page':
        case 'available':
          return reply({ page: accounts.slice(0, body.count), continueCursor: '', isDone: true })
        case 'byId':
          return reply(accounts.find((a) => a._id === body.id) || null)
        case 'availableCount':
          return reply({ available: accounts.length })
        case 'modelSetupList':
          return reply(states)
        case 'modelSetupPatch': {
          const state = states.find((s) => s.profileId === body.profileId)!
          if (body.patch.postSourceIds && failPostSave) {
            failPostSave = false
            res.statusCode = 500
            return reply({ error: 'offline' })
          }
          Object.assign(state, body.patch)
          for (const key of body.clear) delete state[key]
          return reply({ ok: true })
        }
        case 'modelSetupReconcile': {
          const state = states.find((s) => s.profileId === body.profileId)!
          if (body.resolution === 'completed') {
            state.postSourceIds.push(state.pending.sourceId)
            state.postDates.push(state.pending.date)
          }
          delete state.pending
          delete state.error
          return reply({ ok: true })
        }
      }
    }
    res.statusCode = 404
    reply({ error: 'Unknown fixture request' })
  })
  await new Promise<void>((resolve) => convex.listen(0, '127.0.0.1', resolve))
  const native = await nativeFixture({
    CONVEX_URL: 'http://127.0.0.1:' + (convex.address() as { port: number }).port,
    IG_CREDENTIALS_KEY: credentialKey,
  })
  const post = (route: string, body: unknown = {}) =>
    fetch(native.publicUrl + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const internal = (route: string) =>
    fetch(native.url + route, { method: 'POST', headers: native.headers, body: '{}' })
  return {
    ...native,
    post,
    internal,
    accounts,
    calls,
    get profile() {
      return profile
    },
    set profile(value) {
      profile = value
    },
    get states() {
      return states
    },
    set states(value) {
      states = value
    },
    failFinalize() {
      failFinalize = true
    },
    failPostSave() {
      failPostSave = true
    },
    stop: async () => {
      await native.stop()
      await new Promise<void>((resolve) => convex.close(() => resolve()))
    },
  }
}

async function lease(native: Awaited<ReturnType<typeof fixture>>, route: string, args: object) {
  const socket = new WebSocket(native.url.replace(/^http/, 'ws') + route, {
    headers: native.headers,
  })
  const next = () =>
    new Promise<any>((resolve, reject) => {
      const message = (data: WebSocket.RawData) => {
        cleanup()
        resolve(JSON.parse(data.toString()))
      }
      const closed = () => {
        cleanup()
        reject(new Error('Socket closed before reply'))
      }
      const cleanup = () => {
        clearTimeout(timer)
        socket.off('message', message)
        socket.off('close', closed)
        socket.off('error', closed)
      }
      const timer = setTimeout(closed, 5000)
      socket.once('message', message)
      socket.once('close', closed)
      socket.once('error', closed)
    })
  const response = next()
  socket.once('open', () => socket.send(JSON.stringify(args)))
  const ready = await response
  return { socket, ready, next }
}

test('Rust owns profile locks, rename, restart cleanup and reconciliation without Bun routes', async () => {
  const native = await fixture()
  try {
    const old = path.join(native.root, 'data/profiles/Old')
    await fs.mkdir(old, { recursive: true })
    await fs.writeFile(path.join(old, 'cookies'), 'preserve')
    const owner = await lease(native, '/profiles/lease', { profileName: 'Old' })
    expect(owner.ready.ready).toBe(true)
    // The same SQLite protocol remains exclusive across Rust and Bun processes.
    const db = new Database(path.join(native.root, 'data/profile-locks/old.sqlite'))
    expect(() => db.exec('BEGIN IMMEDIATE')).toThrow()
    db.close()
    expect((await native.internal('/profiles/reconcile')).status).toBe(200)
    expect(native.profile!.using).toBe(true)
    const renamedWhileOpen = await fetch(native.publicUrl + '/api/profiles/Old', {
      method: 'PUT',
      body: JSON.stringify({ name: 'New' }),
    })
    expect(renamedWhileOpen.status).toBe(409)
    const ended = new Promise((resolve) => owner.socket.once('close', resolve))
    owner.socket.close()
    await ended
    let response: Response
    for (let tries = 0; ; tries++) {
      response = await fetch(native.publicUrl + '/api/profiles/Old', {
        method: 'PUT',
        body: JSON.stringify({ name: 'New' }),
      })
      if (response.ok || tries >= 20) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(response!.status).toBe(200)
    expect(await fs.readFile(path.join(native.root, 'data/profiles/New/cookies'), 'utf8')).toBe(
      'preserve',
    )
    expect(native.profile!.renameFrom).toBeUndefined()
    expect(await (await native.internal('/profiles/reconcile')).json()).toEqual({
      cleared: 1,
      errors: [],
    })
    native.failFinalize()
    expect((await fetch(native.publicUrl + '/api/profiles/New', { method: 'DELETE' })).status).toBe(
      503,
    )
    expect(native.profile!.status).toBe('deleting')
    expect(await fs.exists(path.join(native.root, 'data/profiles/New'))).toBe(false)
    const pending = await lease(native, '/profiles/lease', { profileName: 'New' })
    expect(pending.ready.error).toContain('maintenance')
    pending.socket.terminate()
    expect((await native.internal('/profiles/maintenance')).status).toBe(200)
    expect(native.profile).toBeNull()
    expect((await fetch(native.publicUrl + '/api/profiles/by-id?id=p')).status).toBe(404)
    expect(
      (await fetch(native.publicUrl + '/api/profiles/..%2Fescape', { method: 'DELETE' })).status,
    ).toBe(400)
  } finally {
    await native.stop()
  }
}, 20_000)

test('Rust imports existing credential format, hides secrets, and isolates unreadable rows', async () => {
  const native = await fixture()
  try {
    const raw = 'Example.User:password:with:colons:JBSWY3DPEHPK3PXP'
    expect(await (await native.post('/api/ig-accounts/import', { text: raw })).json()).toEqual({
      imported: 1,
      skipped: 0,
    })
    expect(
      await (
        await native.post('/api/ig-accounts/import', {
          text: raw.toLowerCase().replace('jbswy3dpehpk3pxp', 'JBSWY3DPEHPK3PXP'),
        })
      ).json(),
    ).toEqual({ imported: 0, skipped: 1 })
    const encrypted = native.accounts[0] as { ciphertext: string; usernameHash: string }
    expect(JSON.stringify(encrypted)).not.toContain('password:with:colons')
    const lookup = createHmac('sha256', Buffer.from(credentialKey, 'hex'))
      .update('ig-username-lookup-v1')
      .digest()
    expect(encrypted.usernameHash).toBe(
      createHmac('sha256', lookup).update('example.user').digest('hex'),
    )
    const [, iv, tag, ciphertext] = encrypted.ciphertext.split('.')
    const cipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(credentialKey, 'hex'),
      Buffer.from(iv, 'base64url'),
    )
    cipher.setAAD(Buffer.from(encrypted.usernameHash, 'hex'))
    cipher.setAuthTag(Buffer.from(tag, 'base64url'))
    expect(
      JSON.parse(
        Buffer.concat([
          cipher.update(Buffer.from(ciphertext, 'base64url')),
          cipher.final(),
        ]).toString(),
      ).username,
    ).toBe('Example.User')
    native.accounts.unshift({
      _id: 'broken',
      ciphertext: 'v1.invalid',
      usernameHash: 'b'.repeat(64),
      createdAt: 1,
      status: 'available',
    })
    const listing = (await (await fetch(native.publicUrl + '/api/ig-accounts')).json()) as Array<
      Record<string, unknown>
    >
    expect(listing.map((a) => a.status)).toEqual(['invalid', 'available'])
    expect(JSON.stringify(listing)).not.toContain('password')
    const page = (await (
      await fetch(native.publicUrl + '/api/ig-accounts/page?search=example')
    ).json()) as { page: Array<Record<string, unknown>> }
    expect(page.page.map((a) => a.username)).toEqual(['Example.User'])
    expect((await native.post('/api/ig-accounts/import', { text: 'invalid' })).status).toBe(400)
    expect(
      (await native.post('/api/ig-accounts/create-batch', { modelId: 'model', count: 101 })).status,
    ).toBe(400)
  } finally {
    await native.stop()
  }
}, 15_000)

for (const outcome of ['shared', 'uncertain', 'disconnect', 'save failure', 'failed']) {
  test(`Rust post lease preserves duplicate protection: ${outcome}`, async () => {
    const native = await fixture()
    try {
      native.states = [
        {
          profileId: 'p',
          modelId: 'model',
          startedAt: Date.now() - 5 * 86_400_000,
          avatarDone: true,
          postSourceIds: [],
          postDates: [],
          postTarget: 1,
        },
      ]
      const root = path.join(native.root, 'data/model-content/model')
      await fs.mkdir(path.join(root, 'posts/photo/variants'), { recursive: true })
      await fs.writeFile(path.join(root, 'posts/photo/variants/one.jpg'), 'fixture')
      await fs.writeFile(
        path.join(root, 'manifest.json'),
        JSON.stringify([
          {
            id: 'photo',
            name: 'source.jpg',
            kind: 'posts',
            variants: ['one.jpg'],
            assigned: {},
            createdAt: 1,
          },
        ]),
      )
      const owner = await lease(native, '/accounts/post-lease', {
        profileId: 'p',
        modelId: 'model',
      })
      expect(owner.ready.error).toBeUndefined()
      expect(owner.ready.content.sourceId).toBe('photo')
      expect(native.states[0].pending.kind).toBe('post')
      expect(
        (await native.post('/api/ig-accounts/warmup/p/reconcile', { resolution: 'completed' }))
          .status,
      ).toBe(409)
      if (outcome === 'disconnect') {
        owner.socket.terminate()
        await new Promise((resolve) => setTimeout(resolve, 50))
      } else {
        if (outcome === 'save failure') native.failPostSave()
        const reply = owner.next()
        owner.socket.send(
          JSON.stringify({ result: outcome === 'save failure' ? 'shared' : outcome }),
        )
        const result = await reply
        if (outcome === 'save failure') expect(result.error).toBeDefined()
        else expect(result.saved).toBe(true)
        owner.socket.terminate()
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
      if (outcome === 'shared') {
        expect(native.states[0].pending).toBeUndefined()
        expect(native.states[0].postSourceIds).toEqual(['photo'])
        expect(native.states[0].outreachReadyMarked).toBe(true)
        const next = await lease(native, '/accounts/post-lease', {
          profileId: 'p',
          modelId: 'model',
        })
        expect(next.ready.content).toBeNull()
        next.socket.terminate()
      } else if (outcome === 'failed') {
        expect(native.states[0].pending).toBeUndefined()
        expect(native.states[0].postSourceIds).toEqual([])
      } else {
        expect(native.states[0].pending.sourceId).toBe('photo')
        expect(native.states[0].postSourceIds).toEqual([])
        const next = await lease(native, '/accounts/post-lease', {
          profileId: 'p',
          modelId: 'model',
        })
        expect(next.ready.content).toBeNull()
        next.socket.terminate()
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(
          (await native.post('/api/ig-accounts/warmup/p/reconcile', { resolution: 'completed' }))
            .status,
        ).toBe(200)
        expect(native.states[0].postSourceIds).toEqual(['photo'])
      }
    } finally {
      await native.stop()
    }
  }, 15_000)
}
