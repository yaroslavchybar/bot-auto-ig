import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  normalizeScriptPath,
  parseRegistryEntries,
  parseWindowsCreationDate,
  registryEntryMatches,
  splitCommandLine,
  type RegistryEntry,
} from './ProcessService.js'
import { resolveProjectRoot } from './utils.js'

const PROJECT_ROOT = resolveProjectRoot(import.meta.url)
const SCRIPT = path.join(path.parse(process.cwd()).root, 'app', 'worker.ts')

const entry = (overrides: Partial<RegistryEntry> = {}): RegistryEntry => ({
  pid: 1234,
  script: SCRIPT,
  detached: true,
  spawnedAt: 1_700_000_000_000,
  ...overrides,
})

test('legacy bare-PID files parse to zero verifiable entries (fail closed)', () => {
  assert.deepEqual(parseRegistryEntries([1234, 5678]), [])
  assert.deepEqual(parseRegistryEntries('nope'), [])
  assert.deepEqual(parseRegistryEntries(null), [])
})

test('registry parsing keeps valid entries and drops malformed ones', () => {
  const parsed = parseRegistryEntries([
    entry(),
    { pid: 1, script: '', detached: true, spawnedAt: 1 },
    { pid: -5, script: 'x', detached: true, spawnedAt: 1 },
    { pid: 2, script: 'x', detached: 'yes', spawnedAt: 1 },
    'junk',
    42,
  ])
  assert.deepEqual(parsed, [entry()])
})

test('registry parsing resolves relative scripts against the project root', () => {
  const parsed = parseRegistryEntries([
    { pid: 7, script: 'server/worker.ts', detached: false, spawnedAt: 5 },
  ])
  assert.deepEqual(parsed, [
    { pid: 7, script: path.resolve(PROJECT_ROOT, 'server/worker.ts'), detached: false, spawnedAt: 5 },
  ])
})

test('identity matches one exact script argument and nearby start time', () => {
  const live = { argv: ['bun', SCRIPT, '--profile', 'x'], startMs: 1_700_000_005_000 }
  assert.equal(registryEntryMatches(entry(), live), true)
})

test('identity rejects a same-named script at a different path', () => {
  const other = path.join(path.parse(process.cwd()).root, 'other', path.basename(SCRIPT))
  const live = { argv: ['bun', other], startMs: 1_700_000_005_000 }
  assert.equal(registryEntryMatches(entry(), live), false)
})

test('identity rejects substring matches that are not an exact argument', () => {
  const live = { argv: [`prefix-${SCRIPT}-suffix`], startMs: 1_700_000_005_000 }
  assert.equal(registryEntryMatches(entry(), live), false)
})

test('identity rejects recycled PIDs with distant start times', () => {
  const live = { argv: ['bun', SCRIPT], startMs: 1_700_000_000_000 + 3_600_000 }
  assert.equal(registryEntryMatches(entry(), live), false)
})

test('command-line splitting honors quotes', () => {
  assert.deepEqual(
    splitCommandLine('bun "C:\\Program Files\\app\\worker.ts" --profile x'),
    ['bun', 'C:\\Program Files\\app\\worker.ts', '--profile', 'x'],
  )
  assert.deepEqual(splitCommandLine(''), [])
})

test('script normalization only folds separators and case on Windows', () => {
  if (process.platform === 'win32') {
    assert.equal(normalizeScriptPath('C:/APP/Worker.TS'), 'c:\\app\\worker.ts')
  } else {
    assert.equal(normalizeScriptPath('/APP/Worker.TS'), '/APP/Worker.TS')
  }
})

test('WMI creation dates parse to UTC millis', () => {
  assert.equal(
    parseWindowsCreationDate('20260913183000.000000+000'),
    Date.UTC(2026, 8, 13, 18, 30, 0),
  )
  assert.equal(
    parseWindowsCreationDate('20260913183000.000000+120'),
    Date.UTC(2026, 8, 13, 16, 30, 0),
  )
  assert.equal(parseWindowsCreationDate('garbage'), null)
  assert.equal(parseWindowsCreationDate(null), null)
})
