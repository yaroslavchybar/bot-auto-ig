import { test, expect } from 'bun:test'
import WebSocket from 'ws'
import { acquireBrowserSlot } from './budget.js'
import { nativeFixture } from '../shared/native-fixture.testing.js'

test('Rust budget queues clients, cancels waiters, and releases disconnected slots', async () => {
  const native = await nativeFixture({ BROWSER_MAX_CONCURRENCY: '1' })
  const previous = process.env.RUNTIME_URL,
    previousKey = process.env.INTERNAL_API_KEY
  process.env.RUNTIME_URL = native.url
  process.env.INTERNAL_API_KEY = 'fixture-key'
  const controller = new AbortController()
  const owner = new WebSocket(native.url.replace(/^http/, 'ws') + '/browser/lease', {
    headers: native.headers,
  })
  let release: (() => void) | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      owner.once('message', () => resolve())
      owner.once('error', reject)
    })
    let granted = false
    const queued = acquireBrowserSlot(controller.signal).then((value) => {
      granted = true
      return value
    })
    await Bun.sleep(30)
    expect(granted).toBe(false)
    const cancel = new AbortController()
    const waiter = acquireBrowserSlot(cancel.signal)
    const rejected = waiter.catch((error) => error)
    cancel.abort(new Error('cancelled'))
    expect((await rejected).message).toBe('cancelled')
    owner.terminate()
    release = await queued
    expect(granted).toBe(true)
    controller.abort(new Error('stop after grant'))
    let nextGranted = false
    const next = acquireBrowserSlot(new AbortController().signal).then((value) => {
      nextGranted = true
      return value
    })
    await Bun.sleep(30)
    expect(nextGranted).toBe(false)
    release()
    release = await next
  } finally {
    owner.terminate()
    release?.()
    await native.stop()
    if (previous === undefined) delete process.env.RUNTIME_URL
    else process.env.RUNTIME_URL = previous
    if (previousKey === undefined) delete process.env.INTERNAL_API_KEY
    else process.env.INTERNAL_API_KEY = previousKey
  }
}, 10000)
