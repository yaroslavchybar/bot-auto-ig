import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errors, type Locator, type Page } from 'playwright-core'
import { sessionTheme, setSessionAppearance } from './appearance.js'
import { BrowseSession, SessionEnded } from './session.js'

test('appearance follows proxy local time, daylight saving and exact day/night boundaries', () => {
  for (const [time, expected] of [
    ['2026-07-01T10:59:59Z', 'dark'], ['2026-07-01T11:00:00Z', 'light'],
    ['2026-07-01T22:59:59Z', 'light'], ['2026-07-01T23:00:00Z', 'dark'],
    ['2026-01-01T11:59:59Z', 'dark'], ['2026-01-01T12:00:00Z', 'light'],
  ]) assert.equal(sessionTheme('America/New_York', Date.parse(time)), expected)
  const now = Date.parse('2026-10-15T17:00:00Z')
  assert.equal(sessionTheme('Europe/Kyiv', now), 'dark')
  assert.equal(sessionTheme('America/New_York', now), 'light')
  assert.equal(sessionTheme('Asia/Kathmandu', now), 'dark')
  assert.equal(sessionTheme(undefined, now), undefined)
  assert.equal(sessionTheme('Invalid/Zone', now), undefined)
})

function fixture(dark: boolean, time = '2026-10-15T12:00:00Z', panelVisible = true) {
  let opened = false, submenu = false, stopped = false
  const clicks: string[] = [], notes: Record<string, unknown>[] = []
  type Target = 'menu' | 'panel' | 'dialogs' | 'appearance' | 'switch' | 'dark' | 'root-light' | 'root-dark'
  const visible = (kind: Target) => kind === 'menu' || kind === 'root-light' && !dark || kind === 'root-dark' && dark ||
    opened && (kind === 'panel' && panelVisible || kind === 'dialogs' || kind === 'appearance' && !submenu || submenu && (kind === 'dark' || kind === 'switch'))
  const locate = (kind: Target): Locator => ({
    kind, first() { return this }, last() { return this },
    filter: (options: { hasText?: string }) => locate(options.hasText ? 'panel' : kind),
    isVisible: async () => visible(kind), count: async () => Number(visible(kind)),
    getByRole: (role: string, options?: { name?: unknown }) => locate(role === 'switch' ? 'switch' : options?.name === 'Dark mode' ? 'dark' : 'appearance'),
    getAttribute: async (name: string) => { assert.equal(kind, 'switch'); assert.equal(name, 'aria-checked'); return String(dark) },
    waitFor: async ({ state }: { state: string }) => {
      if (visible(kind) !== (state === 'visible')) throw new errors.TimeoutError('Control state did not settle')
    },
  }) as unknown as Locator
  const page = { locator: (selector: string) => locate(selector.startsWith('html.__fb-') ? selector.includes('dark') ? 'root-dark' : 'root-light' : 'menu'),
    getByRole: () => locate('dialogs'),
  } as unknown as Page
  const deps: NonNullable<Parameters<typeof setSessionAppearance>[4]> = {
    now: () => Date.parse(time), check: async () => {},
    click: async (_page, target) => {
      const kind = (target as unknown as { kind: Target }).kind
      clicks.push(kind)
      if (kind === 'menu') opened = !opened
      else if (kind === 'appearance') submenu = true
      else if (kind === 'dark') dark = !dark
      else assert.fail('Click the Dark mode row, not its nested checkbox')
    },
  }
  const parent = new BrowseSession(Infinity, () => stopped)
  const run = async (timezone: string | undefined = 'Europe/Kyiv') => {
    const originalNow = Date.now
    Date.now = deps.now
    try { await setSessionAppearance(page, timezone, parent, note => notes.push(note), deps) }
    finally { Date.now = originalNow }
  }
  return { run, deps, clicks, notes, opened: () => opened, dark: () => dark, stop: () => { stopped = true } }
}

for (const dark of [false, true]) test(`startup sets the desired saved theme and closes its menu (${dark})`, async () => {
  const s = fixture(dark, dark ? '2026-10-15T12:00:00Z' : '2026-10-15T20:00:00Z')
  await s.run()
  assert.deepEqual(s.clicks, ['menu', 'appearance', 'dark', 'menu'])
  assert.equal(s.dark(), !dark); assert.equal(s.opened(), false)
  assert.equal(s.notes[0]?.outcome, 'switched')
  await s.run(); assert.equal(s.clicks.length, 4, 'already-correct themes receive no further clicks')
  assert.equal(s.notes.at(-1)?.outcome, 'unchanged')
})

test('unknown proxy timezone leaves the page untouched', async () => {
  const s = fixture(true)
  await s.run('Invalid/Zone')
  assert.deepEqual(s.clicks, []); assert.equal(s.dark(), true)
  assert.equal(s.notes[0]?.reason, 'proxy_timezone_unknown')
})

test('a temporary appearance failure closes the menu and does not end browsing', async () => {
  const s = fixture(true), click = s.deps.click
  s.deps.click = async (...args) => {
    if ((args[1] as unknown as { kind: string }).kind === 'dark') throw new errors.TimeoutError('Switch disappeared')
    await click(...args)
  }
  await s.run(); assert.equal(s.opened(), false); assert.equal(s.dark(), true)
  assert.equal(s.notes.at(-1)?.outcome, 'skipped')
})

test('a submenu timeout closes More even when the appearance panel stays hidden', async () => {
  const s = fixture(true, '2026-10-15T12:00:00Z', false), click = s.deps.click
  s.deps.click = async (...args) => {
    if ((args[1] as unknown as { kind: string }).kind === 'appearance') throw new errors.TimeoutError('Submenu did not appear')
    await click(...args)
  }
  await s.run()
  assert.deepEqual(s.clicks, ['menu', 'menu'])
  assert.equal(s.opened(), false); assert.equal(s.dark(), true)
  assert.equal(s.notes.at(-1)?.outcome, 'skipped')
})

test('cleanup does not open More when its initial click failed before opening it', async () => {
  const s = fixture(true)
  let attempts = 0
  s.deps.click = async () => { attempts++; throw new errors.TimeoutError('Menu click failed') }
  await s.run()
  assert.equal(attempts, 1); assert.equal(s.opened(), false)
  assert.equal(s.notes.at(-1)?.outcome, 'skipped')
})

test('appearance changes preserve cancellation and account-warning behavior', async () => {
  const s = fixture(true)
  s.deps.click = async () => { s.stop(); throw new SessionEnded('Stopped') }
  await assert.rejects(s.run(), SessionEnded)
  const warned = fixture(true)
  warned.deps.check = async () => { throw new Error('Instagram checkpoint needs attention') }
  await assert.rejects(warned.run(), /checkpoint/)
  assert.deepEqual(warned.clicks, [])
})
