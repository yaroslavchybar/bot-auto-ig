import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { acquireBrowserSlot, createBrowserBudget } from './budget.js'

test('shared budget queues clients, cancels waiters, and reclaims disconnected slots', { timeout: 5000 }, async () => {
  const name = `ig-budget-test-${randomUUID()}`
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : path.join(os.tmpdir(), name)
  const server = createBrowserBudget(endpoint, 1)
  await once(server, 'listening')
  const owner = net.connect(endpoint)
  let release: (() => void) | undefined
  try {
    await once(owner, 'data')
    let granted = false
    const queued = acquireBrowserSlot(new AbortController().signal, endpoint).then(value => { granted = true; return value })
    await once(server, 'connection')
    assert.equal(granted, false)
    const cancelled = new AbortController()
    const waiter = acquireBrowserSlot(cancelled.signal, endpoint)
    await once(server, 'connection')
    cancelled.abort(new Error('cancelled'))
    await assert.rejects(waiter, /cancelled/)
    owner.destroy()
    release = await queued
    assert.equal(granted, true)
    release()
    release = await acquireBrowserSlot(new AbortController().signal, endpoint)
  } finally {
    owner.destroy()
    release?.()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('a killed worker releases its budget slot for another worker', { timeout: 5000 }, async () => {
  const name = `ig-budget-process-${randomUUID()}`
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : path.join(os.tmpdir(), name)
  const server = createBrowserBudget(endpoint, 1)
  await once(server, 'listening')
  const child = spawn(process.execPath, ['-e',
    "const net = require('node:net'); const socket = net.connect(process.env.TEST_BUDGET_PIPE); socket.on('data', () => process.stdout.write('ready'));"],
    { env: { ...process.env, TEST_BUDGET_PIPE: endpoint }, stdio: ['ignore', 'pipe', 'pipe'] })
  let release: (() => void) | undefined
  try {
    await once(child.stdout!, 'data')
    const pending = acquireBrowserSlot(new AbortController().signal, endpoint)
    await once(server, 'connection')
    const exited = once(child, 'exit')
    child.kill()
    await exited
    release = await pending
    assert.equal(typeof release, 'function')
  } finally {
    child.kill()
    release?.()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
