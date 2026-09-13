import { clients, logsStore } from './shared/store.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { WebSocket } from 'ws'
import { broadcast, sendBounded } from './websocket.js'

test('slow clients are terminated before another message is buffered', () => {
  let sent = 0
  let terminated = 0
  const client = { bufferedAmount: 9, send: () => { sent++ }, terminate: () => { terminated++ } } as unknown as WebSocket
  sendBounded(client, 'é', 10)
  assert.equal(sent, 0)
  assert.equal(terminated, 1)
})

test('healthy clients receive messages and send errors terminate the socket', () => {
  let sent = ''
  let terminated = false
  const client = {
    bufferedAmount: 0,
    send: (message: string, callback: (error?: Error) => void) => { sent = message; callback(new Error('gone')) },
    terminate: () => { terminated = true },
  } as unknown as WebSocket
  sendBounded(client, 'hello')
  assert.equal(sent, 'hello')
  assert.equal(terminated, true)
})

test('history and live logs share a stable identifier and timestamp', () => {
  const messages: Array<Record<string, unknown>> = []
  const client = { readyState: 1, bufferedAmount: 0, send: (raw: string) => messages.push(JSON.parse(raw)) } as unknown as WebSocket
  clients.add(client)
  try {
    broadcast({ type: 'log', message: 'same text' })
    broadcast({ type: 'log', message: 'same text' })
    assert.notEqual(messages[0].id, messages[1].id)
    assert.equal(messages[1].id, logsStore.at(-1)?.id)
    assert.equal(messages[1].ts, logsStore.at(-1)?.ts)
  } finally { clients.delete(client) }
})
