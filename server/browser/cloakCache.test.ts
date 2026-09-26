import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pruneOldCloakBrowsers } from './cloakCache.js'

function makeCache(): { root: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloak-cache-'))
  return {
    root,
    cleanup: () => {
      assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
      fs.rmSync(root, { recursive: true, force: true })
    },
  }
}

function binaryPath(directory: string): string {
  return process.platform === 'win32' ? path.join(directory, 'chrome.exe')
    : process.platform === 'darwin' ? path.join(directory, 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
      : path.join(directory, 'chrome')
}

function makeBinary(directory: string, contents = 'browser'): void {
  const executable = binaryPath(directory)
  fs.mkdirSync(path.dirname(executable), { recursive: true })
  fs.writeFileSync(executable, contents)
  fs.chmodSync(executable, 0o755)
}

test('pruning keeps the highest version even when an older binary is newer on disk', (t) => {
  const { root, cleanup } = makeCache()
  t.after(cleanup)
  const oldBin = path.join(root, 'chromium-151.0.7922.108.6-pro')
  const newBin = path.join(root, 'chromium-152.0.7977.82.1-pro')
  makeBinary(oldBin, 'old')
  makeBinary(newBin, 'new')
  fs.writeFileSync(path.join(root, 'latest_pro_version_linux-x64'), '152.0.7977.82.1')
  fs.mkdirSync(path.join(root, 'geoip'), { recursive: true })
  fs.writeFileSync(path.join(root, 'geoip', 'db.mmdb'), 'geo')
  fs.writeFileSync(path.join(root, '.license_cache'), 'key')
  const now = Date.now()
  fs.utimesSync(oldBin, new Date(now), new Date(now))
  fs.utimesSync(newBin, new Date(now - 86_400_000), new Date(now - 86_400_000))

  const pruned = pruneOldCloakBrowsers(root)

  assert.deepEqual(pruned, ['chromium-151.0.7922.108.6-pro'])
  assert.equal(fs.existsSync(oldBin), false)
  assert.equal(fs.readFileSync(binaryPath(newBin), 'utf8'), 'new')
  assert.equal(fs.readFileSync(path.join(root, 'geoip', 'db.mmdb'), 'utf8'), 'geo')
  assert.equal(fs.readFileSync(path.join(root, '.license_cache'), 'utf8'), 'key')
})

test('pruning uses timestamps consistently when a candidate version is unparseable', (t) => {
  const { root, cleanup } = makeCache()
  t.after(cleanup)
  const highest = path.join(root, 'chromium-3-pro')
  const middle = path.join(root, 'chromium-2-pro')
  const unparseable = path.join(root, 'chromium-dev-pro')
  for (const dir of [highest, middle, unparseable]) makeBinary(dir)
  fs.writeFileSync(path.join(root, 'latest_pro_version_linux-x64'), '3')
  const now = Date.now()
  fs.utimesSync(highest, new Date(now), new Date(now))
  fs.utimesSync(middle, new Date(now - 60_000), new Date(now - 60_000))
  fs.utimesSync(unparseable, new Date(now - 120_000), new Date(now - 120_000))

  assert.deepEqual(pruneOldCloakBrowsers(root), ['chromium-2-pro', 'chromium-dev-pro'])
  assert.equal(fs.existsSync(highest), true)
})

test('pruning a missing or binary-free cache is a no-op', (t) => {
  const { root, cleanup } = makeCache()
  t.after(cleanup)
  assert.deepEqual(pruneOldCloakBrowsers(path.join(root, 'absent')), [])
  fs.writeFileSync(path.join(root, 'latest_pro_version_linux-x64'), 'x')
  assert.deepEqual(pruneOldCloakBrowsers(root), [])
})

test('pruning ignores regular files that look like browser directories', (t) => {
  const { root, cleanup } = makeCache()
  t.after(cleanup)
  const installed = path.join(root, 'chromium-998-pro')
  const fake = path.join(root, 'chromium-999-pro')
  makeBinary(installed)
  fs.writeFileSync(fake, 'not a browser directory')
  const now = Date.now()
  fs.utimesSync(installed, new Date(now - 60_000), new Date(now - 60_000))
  fs.utimesSync(fake, new Date(now), new Date(now))

  assert.deepEqual(pruneOldCloakBrowsers(root), [])
  assert.equal(fs.existsSync(installed), true)
  assert.equal(fs.readFileSync(fake, 'utf8'), 'not a browser directory')
})

test('pruning never deletes the version named by the marker', (t) => {
  const { root, cleanup } = makeCache()
  t.after(cleanup)
  const oldBin = path.join(root, 'chromium-151.0.7922.108.6-pro')
  const newBin = path.join(root, 'chromium-152.0.7977.82.1-pro')
  makeBinary(oldBin)
  makeBinary(newBin)
  const now = Date.now()
  fs.utimesSync(oldBin, new Date(now - 86_400_000), new Date(now - 86_400_000))
  fs.utimesSync(newBin, new Date(now), new Date(now))
  fs.writeFileSync(path.join(root, 'latest_pro_version_linux-x64'), '151.0.7922.108.6')
  assert.deepEqual(pruneOldCloakBrowsers(root), [])
  assert.equal(fs.existsSync(oldBin), true)
  assert.equal(fs.existsSync(newBin), true)
})

test('pruning protects the configured binary path and pinned version', (t) => {
  const { root, cleanup } = makeCache()
  t.after(cleanup)
  const configured = path.join(root, 'chromium-150.0.1-pro')
  const alias = path.join(root, 'configured-browser')
  const pinned = path.join(root, 'chromium-149.0.1-pro')
  const newest = path.join(root, 'chromium-152.0.1-pro')
  const unprotected = path.join(root, 'chromium-148.0.1-pro')
  for (const dir of [configured, pinned, newest, unprotected]) makeBinary(dir)
  fs.writeFileSync(path.join(root, 'latest_pro_version_linux-x64'), '152.0.1')
  fs.symlinkSync(configured, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const now = Date.now()
  for (const [index, dir] of [newest, pinned, configured, unprotected].entries()) {
    const time = new Date(now - index * 60_000)
    fs.utimesSync(dir, time, time)
  }

  const previousBinaryPath = process.env.CLOAKBROWSER_BINARY_PATH
  const previousVersion = process.env.CLOAKBROWSER_VERSION
  process.env.CLOAKBROWSER_BINARY_PATH = path.join(alias, path.basename(binaryPath(configured)))
  process.env.CLOAKBROWSER_VERSION = '149.0.1'
  t.after(() => {
    if (previousBinaryPath === undefined) delete process.env.CLOAKBROWSER_BINARY_PATH
    else process.env.CLOAKBROWSER_BINARY_PATH = previousBinaryPath
    if (previousVersion === undefined) delete process.env.CLOAKBROWSER_VERSION
    else process.env.CLOAKBROWSER_VERSION = previousVersion
  })

  assert.deepEqual(pruneOldCloakBrowsers(root), ['chromium-148.0.1-pro'])
  assert.equal(fs.existsSync(configured), true)
  assert.equal(fs.existsSync(pinned), true)
  assert.equal(fs.existsSync(newest), true)
  assert.equal(fs.existsSync(unprotected), false)
})
