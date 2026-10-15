import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { Page } from 'playwright-core'
import { attachSessionDecisions, beginSessionDecision, publishSessionDecision } from './session-decision.js'
import type { SessionDecision } from '../../shared/sessionDecision.js'

test('decisions stay on their page, clear on navigation, and ignore late results after navigation or cleanup', () => {
  const frame = {}, otherFrame = {}
  const page = Object.assign(new EventEmitter(), { mainFrame: () => frame }) as unknown as Page
  const other = Object.assign(new EventEmitter(), { mainFrame: () => otherFrame }) as unknown as Page
  const results: Array<SessionDecision | null> = []
  const detach = attachSessionDecisions(page, result => results.push(result))
  const pending = beginSessionDecision(page, { kind: 'interest', status: 'checking' })
  publishSessionDecision(other, { kind: 'interest', status: 'unavailable' })
  page.emit('framenavigated', otherFrame as never)
  assert.equal(results.length, 1)
  page.emit('framenavigated', frame as never)
  pending({ kind: 'interest', status: 'complete', confidence: 0.9, related: true })
  assert.deepEqual(results, [{ kind: 'interest', status: 'checking' }, null])
  const old = beginSessionDecision(page, { kind: 'interest', status: 'checking' })
  const current = beginSessionDecision(page, { kind: 'profile', status: 'checking', username: 'lead' })
  old({ kind: 'interest', status: 'complete', confidence: 0.9, related: true })
  current({ kind: 'profile', status: 'complete', username: 'lead', category: 'business', confidence: 0.8 })
  assert.equal(results.at(-1)?.kind, 'profile')
  const delayed = beginSessionDecision(page, { kind: 'interest', status: 'checking' })
  detach()
  const count = results.length
  delayed({ kind: 'interest', status: 'unavailable' })
  publishSessionDecision(page, null)
  assert.equal(results.length, count)
  assert.equal((page as unknown as EventEmitter).listenerCount('framenavigated'), 0)
})
