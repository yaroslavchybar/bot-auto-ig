import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPreviewCache } from './preview.js'
import type { ActiveDisplaySession } from '../shared/store.js'

const session = (port: number): ActiveDisplaySession => ({
  automationId: 'manual', profileName: String(port), vncPort: port,
  displayNum: port - 5981, status: 'active',
})

test('preview requests share pending work and cached images, then refresh after expiry', async () => {
  const display = session(6081)
  const sessions = new Map([['one', display]])
  let time = 0
  let captures = 0
  const jpeg = Buffer.from('jpeg')
  const get = createPreviewCache(async () => { captures++; return jpeg }, sessions, () => time)
  const first = get(display)
  const second = get(display)
  assert.deepEqual(await Promise.all([first, second]), [jpeg, jpeg])
  await get(display)
  assert.equal(captures, 1)
  time = 8001
  await get(display)
  assert.equal(captures, 2)
})

test('at most two previews are captured at once and queued sessions are checked again', async () => {
  const displays = [session(6081), session(6082), session(6083)]
  const sessions = new Map(displays.map((display) => [display.profileName, display]))
  const releases: Array<() => void> = []
  let captures = 0
  const get = createPreviewCache(async () => {
    captures++
    await new Promise<void>((resolve) => releases.push(resolve))
    return Buffer.from('jpeg')
  }, sessions)
  const first = get(displays[0])
  const second = get(displays[1])
  const third = get(displays[2])
  const ended = assert.rejects(third, /session ended/)
  assert.equal(captures, 2)
  sessions.delete(displays[2].profileName)
  releases.forEach((resolve) => resolve())
  await Promise.all([first, second, ended])
  assert.equal(captures, 2)
})

test('failed captures can retry and ended sessions cannot leak cached images to reused ports', async () => {
  const display = session(6081)
  const sessions = new Map([['one', display]])
  let fail = true
  const get = createPreviewCache(async () => {
    if (fail) throw new Error('capture failed')
    return Buffer.from('new jpeg')
  }, sessions)
  await assert.rejects(get(display), /capture failed/)
  fail = false
  assert.equal((await get(display)).toString(), 'new jpeg')
  sessions.set('one', session(6081))
  await assert.rejects(get(display), /session ended/)
  assert.equal((await get(sessions.get('one')!)).toString(), 'new jpeg')
})

test('one requester leaving preserves a shared capture; the last cancels it and can retry', async () => {
  const display = session(6081)
  const signals: AbortSignal[] = []
  const releases: Array<() => void> = []
  const get = createPreviewCache(async (_session, signal) => {
    signals.push(signal)
    await new Promise<void>((resolve) => releases.push(resolve))
    return Buffer.from('jpeg')
  }, new Map([['one', display]]))
  const a = new AbortController()
  const b = new AbortController()
  const first = get(display, a.signal)
  const second = get(display, b.signal)
  const firstCancelled = assert.rejects(first, { name: 'AbortError' })
  a.abort()
  await firstCancelled
  assert.equal(signals[0].aborted, false)
  assert.equal(signals.length, 1)
  const secondCancelled = assert.rejects(second, { name: 'AbortError' })
  b.abort()
  await secondCancelled
  assert.equal(signals[0].aborted, true)

  // A late failure from the abandoned capture must not evict the replacement.
  const replacement = get(display)
  releases[0]()
  await new Promise<void>((resolve) => setImmediate(resolve))
  const sharedReplacement = get(display)
  assert.equal(signals.length, 2)
  releases[1]()
  await Promise.all([replacement, sharedReplacement])
})

test('cancelled queued previews never capture or block the next requester', async () => {
  const displays = [6081, 6082, 6083, 6084].map(session)
  const captures: number[] = []
  const releases: Array<() => void> = []
  const get = createPreviewCache(async (display) => {
    captures.push(display.vncPort)
    await new Promise<void>((resolve) => releases.push(resolve))
    return Buffer.from('jpeg')
  }, new Map(displays.map(display => [display.profileName, display])))
  const first = get(displays[0])
  const second = get(displays[1])
  const controller = new AbortController()
  const cancelled = assert.rejects(get(displays[2], controller.signal), { name: 'AbortError' })
  const fourth = get(displays[3])
  controller.abort()
  await cancelled
  releases[0]()
  await first
  assert.deepEqual(captures, [6081, 6082, 6084])
  releases[1]()
  releases[2]()
  await Promise.all([second, fourth])
  await assert.rejects(get(displays[2], controller.signal), { name: 'AbortError' })
  assert.equal(captures.length, 3)
})
