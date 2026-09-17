import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { AppError } from '../shared/errors.js'
import { resolveProjectRoot } from '../shared/utils.js'
import filesRouter from './routes.js'

const PROJECT_ROOT = resolveProjectRoot(import.meta.url)
const UPLOAD_DIR = path.join(PROJECT_ROOT, 'data', 'uploads')

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/', filesRouter)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } })
      return
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
  })
  return app
}

async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const app = buildApp()
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    )
  }
}

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.txt`
}

async function listNames(base: string, root = 'general', dirPath = ''): Promise<string[]> {
  const res = await fetch(
    `${base}/list?root=${encodeURIComponent(root)}&path=${encodeURIComponent(dirPath)}`,
  )
  assert.equal(res.status, 200)
  const body = (await res.json()) as { entries: { name: string }[] }
  return body.entries.map((e) => e.name)
}

test('GET /roots lists General and Profile Uploads', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/roots`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as { id: string; label: string; kind: string }[]
    assert.deepEqual(
      body.map((r) => [r.id, r.kind]),
      [
        ['general', 'general'],
        ['profiles', 'profiles'],
      ],
    )
    assert.equal(body[0]?.label, 'General Uploads')
    assert.equal(body[1]?.label, 'Profile Uploads')
  })
})

test('path traversal outside a root is rejected', async () => {
  await withServer(async (base) => {
    for (const target of [
      '/list?root=general&path=../..',
      '/list?root=general&path=%2E%2E%2F%2E%2E',
      '/?root=general&path=.&name=..',
    ]) {
      const res = await fetch(`${base}${target}`, {
        method: target.startsWith('/?') ? 'DELETE' : 'GET',
      })
      assert.ok(
        res.status === 400 || res.status === 404,
        `${target} -> ${res.status}`,
      )
    }
  })
})

test('unknown root is rejected', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/list?root=nope&path=`)
    assert.equal(res.status, 400)
  })
})

test('mkdir and rename reject bad names without touching disk', async () => {
  await withServer(async (base) => {
    const mkdir = await fetch(`${base}/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: 'general', path: '', name: '..' }),
    })
    assert.equal(mkdir.status, 400)

    // '../evil' contains a separator — rejected outright, never
    // rewritten to 'evil', so the response is always a 400.
    const rename = await fetch(`${base}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: 'general', path: '', from: 'a', to: '../evil' }),
    })
    assert.equal(rename.status, 400)
  })
})

test('upload streams a file and delete removes it', async () => {
  await withServer(async (base) => {
    const name = uniqueName('roundtrip')
    const upload = await fetch(`${base}/upload?root=general&path=`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'X-Filename': name },
      body: 'hello-files',
    })
    assert.equal(upload.status, 200)
    const created = (await upload.json()) as { filename: string; size: number }
    assert.equal(created.filename, name)
    assert.equal(created.size, 'hello-files'.length)
    assert.ok((await listNames(base)).includes(name))

    const download = await fetch(
      `${base}/download?root=general&path=&name=${encodeURIComponent(name)}`,
    )
    assert.equal(download.status, 200)
    assert.equal(await download.text(), 'hello-files')

    const del = await fetch(
      `${base}/?root=general&path=&name=${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    )
    assert.equal(del.status, 200)
    assert.ok(!(await listNames(base)).includes(name))
  })
})

test('a profile folder stores files under Profile Uploads', async () => {
  await withServer(async (base) => {
    const profile = `testprofile-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const name = uniqueName('pic')
    const dir = path.join(UPLOAD_DIR, 'profiles', profile)
    try {
      const mkdir = await fetch(`${base}/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: 'profiles', path: '', name: profile }),
      })
      assert.equal(mkdir.status, 200)
      const upload = await fetch(
        `${base}/upload?root=profiles&path=${encodeURIComponent(profile)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg', 'X-Filename': name },
          body: 'fake-jpeg',
        },
      )
      assert.equal(upload.status, 200)
      assert.ok((await listNames(base, 'profiles', profile)).includes(name))
      // Profile files stay out of General.
      assert.ok(!(await listNames(base, 'general')).includes(name))
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

test('delete by a rewritten name is rejected and touches nothing', async () => {
  await withServer(async (base) => {
    const real = uniqueName('exact').replace(/-/g, '_')
    const create = await fetch(`${base}/upload?root=general&path=`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'X-Filename': real },
      body: 'keep-me',
    })
    assert.equal(create.status, 200)
    try {
      // 'a:b' must not be silently rewritten to an existing 'a_b'-style
      // name — it addresses nothing, so the delete 404s and the real
      // file survives (the old rewrite would have deleted it with 200).
      const evil = real.replace(/_/g, ':')
      assert.notEqual(evil, real)
      const del = await fetch(
        `${base}/?root=general&path=&name=${encodeURIComponent(evil)}`,
        { method: 'DELETE' },
      )
      assert.equal(del.status, 404)
      assert.ok((await listNames(base)).includes(real))
    } finally {
      await fetch(
        `${base}/?root=general&path=&name=${encodeURIComponent(real)}`,
        { method: 'DELETE' },
      )
    }
  })
})

test('upload rejects unsupported characters instead of rewriting', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/upload?root=general&path=`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'X-Filename': 'a:b.txt' },
      body: 'nope',
    })
    assert.equal(res.status, 400)
  })
})

test('symlinks cannot escape managed roots', async () => {
  const outside = path.join(os.tmpdir(), `files-test-secret-${Date.now()}.txt`)
  await fs.writeFile(outside, 'secret')
  const linkName = uniqueName('link')
  const generalDir = path.join(UPLOAD_DIR, 'general')
  const linkPath = path.join(generalDir, linkName)
  try {
    await fs.mkdir(generalDir, { recursive: true })
    try {
      await fs.symlink(outside, linkPath)
    } catch {
      // Windows without developer rights can't create symlinks — skip.
      return
    }
    try {
      await withServer(async (base) => {
        const download = await fetch(
          `${base}/download?root=general&path=&name=${encodeURIComponent(linkName)}`,
        )
        assert.equal(download.status, 400)

        const del = await fetch(
          `${base}/?root=general&path=&name=${encodeURIComponent(linkName)}`,
          { method: 'DELETE' },
        )
        // Deleting the link itself is confined — either accepted (link
        // removed, target kept) or rejected; the target must survive.
        assert.ok(del.status === 200 || del.status === 400)
        assert.equal(await fs.readFile(outside, 'utf8'), 'secret')
      })
    } finally {
      await fs.unlink(linkPath).catch(() => undefined)
    }
  } finally {
    await fs.unlink(outside).catch(() => undefined)
  }
})
