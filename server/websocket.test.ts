import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { WebSocket } from 'ws'
import { sendBounded } from './websocket.js'

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
