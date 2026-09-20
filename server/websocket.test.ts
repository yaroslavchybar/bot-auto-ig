import { clients, logsStore } from './shared/store.js'
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

test('broadcast routes display events and scoped logs without dropping the general feed', () => {
  const feeds = ['topic=displays', 'topic=logs&automationId=a&profileName=ALICE', 'topic=logs', '']
    .map(query => {
      const messages: Array<Record<string, unknown>> = []
      const client = {
        readyState: 1, bufferedAmount: 0, subscription: parseSubscription(new URLSearchParams(query)),
        send: (raw: string) => messages.push(JSON.parse(raw)),
      } as unknown as WebSocket
      clients.add(client)
      return { client, messages }
    })
  try {
    for (const type of ['display_allocated', 'display_released', 'profile_completed', 'automation_status']) {
      broadcast({ type, automationId: 'a' })
    }
    broadcast({ type: 'log', automationId: 'a', profileName: 'Alice', message: 'match' })
    broadcast({ type: 'log', automationId: 'a', profileName: 'Bob', message: 'other profile' })
    broadcast({ type: 'log', automationId: 'b', profileName: 'Alice', message: 'other automation' })
    broadcast({ type: 'task_started' })
    assert.equal(feeds[0].messages.length, 4)
    assert.deepEqual(feeds[1].messages.map(message => message.message), ['match'])
    assert.equal(feeds[2].messages.length, 3)
    assert.equal(feeds[3].messages.length, 8)
    assert.equal(logsStore.at(-1)?.message, 'other automation')
  } finally { feeds.forEach(({ client }) => clients.delete(client)) }
})
