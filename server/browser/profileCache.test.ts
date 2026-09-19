import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pruneProfileCache } from './profileCache.js'

test('pruning removes disposable caches and preserves identity and site storage', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-cache-'))
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
    fs.rmSync(root, { recursive: true, force: true })
  })
  const caches = ['Default/Cache/data', 'Default/Code Cache/js/data',
    'Default/GPUCache/data', 'Default/Media Cache/data', 'ShaderCache/data',
    'GrShaderCache/data', 'GraphiteDawnCache/data']
  const preserved = ['Default/Network/Cookies', 'Default/Cookies',
    'Default/Local Storage/leveldb/data', 'Default/IndexedDB/data',
    'Default/Service Worker/CacheStorage/data', 'Default/Preferences',
    'cloak-seed.json', 'worker.lock', 'xdg/gtk-3.0/bookmarks']
  for (const relative of [...caches, ...preserved]) {
    const file = path.join(root, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, relative)
  }
  await pruneProfileCache(root)
  await pruneProfileCache(root)
  for (const relative of caches) assert.equal(fs.existsSync(path.join(root, relative)), false)
  for (const relative of preserved) assert.equal(fs.readFileSync(path.join(root, relative), 'utf8'), relative)
})

test('pruning does not follow a redirected Default directory', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-cache-link-'))
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
    fs.rmSync(root, { recursive: true, force: true })
  })
  const profile = path.join(root, 'profile')
  const outside = path.join(root, 'outside')
  fs.mkdirSync(profile)
  fs.mkdirSync(path.join(outside, 'Cache'), { recursive: true })
  fs.writeFileSync(path.join(outside, 'Cache', 'keep'), 'keep')
  fs.symlinkSync(outside, path.join(profile, 'Default'), process.platform === 'win32' ? 'junction' : 'dir')
  await pruneProfileCache(profile)
  assert.equal(fs.readFileSync(path.join(outside, 'Cache', 'keep'), 'utf8'), 'keep')
})
