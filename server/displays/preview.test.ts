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
  const get = createPreviewCache(async () => { captures++; return 'jpeg' }, sessions, () => time)
  const first = get(display)
  const second = get(display)
  assert.equal(first, second)
  assert.deepEqual(await Promise.all([first, second]), ['jpeg', 'jpeg'])
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
    return 'jpeg'
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
    return 'new jpeg'
  }, sessions)
  await assert.rejects(get(display), /capture failed/)
  fail = false
  assert.equal(await get(display), 'new jpeg')
  sessions.set('one', session(6081))
  await assert.rejects(get(display), /session ended/)
  assert.equal(await get(sessions.get('one')!), 'new jpeg')
})
