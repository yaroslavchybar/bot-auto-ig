import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachRfbListeners } from './connectionEvents'

test('server-initiated clean closes retry, intentional cleanup and handshake failures do not', () => {
  const rfb = new EventTarget()
  const lifecycle = { disposed: false, terminalFailure: false }
  let retries = 0
  attachRfbListeners(rfb, lifecycle, () => {}, { current: 0 }, () => {}, () => { retries++ })
  rfb.dispatchEvent(new CustomEvent('disconnect', { detail: { clean: true } }))
  assert.equal(retries, 1)
  lifecycle.disposed = true
  rfb.dispatchEvent(new CustomEvent('disconnect', { detail: { clean: true } }))
  assert.equal(retries, 1)
  lifecycle.disposed = false
  rfb.dispatchEvent(new CustomEvent('securityfailure', { detail: { status: 1 } }))
  rfb.dispatchEvent(new Event('disconnect'))
  assert.equal(retries, 1)
})
