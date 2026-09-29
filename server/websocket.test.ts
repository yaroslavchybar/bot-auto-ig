import { clients } from './shared/store.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { WebSocket } from 'ws'
import { broadcast, sendBounded } from './websocket.js'
import { parseSubscription } from './shared/subscriptions.js'

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

test('broadcast sends control events to the general feed and display changes to display subscribers', () => {
  const feeds = ['topic=displays', ''].map(query => {
    const messages: Array<Record<string, unknown>> = []
    const client = {
      readyState: 1, bufferedAmount: 0, subscription: parseSubscription(new URLSearchParams(query)),
      send: (raw: string) => messages.push(JSON.parse(raw)),
    } as unknown as WebSocket
    clients.add(client)
    return { client, messages }
  })
  try {
    for (const type of ['display_allocated', 'display_released', 'profile_completed', 'automation_status'])
      broadcast({ type, automationId: 'a' })
    broadcast({ type: 'task_started' })
    assert.equal(feeds[0].messages.length, 4)
    assert.equal(feeds[1].messages.length, 5)
  } finally { feeds.forEach(({ client }) => clients.delete(client)) }
})
