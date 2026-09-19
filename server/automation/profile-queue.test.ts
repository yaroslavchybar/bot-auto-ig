import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orderProfileQueue, profileProxyKey } from './profile-queue.js'

const profile = (proxy: string, id = proxy) => ({ id, proxy: `${proxy}:8080` })

test('spreads uneven proxy groups without losing profiles or changing input', () => {
  const profiles = [profile('b'), profile('c'), profile('a', 'a1'), profile('a', 'a2'), profile('a', 'a3')]
  const original = [...profiles]
  assert.deepEqual(orderProfileQueue(profiles).map(p => p.id), ['a1', 'b', 'a2', 'c', 'a3'])
  assert.deepEqual(profiles, original)
})

test('avoids the previous batch proxy and drains unavoidable repeats', () => {
  assert.deepEqual(orderProfileQueue([profile('a'), profile('b')], profileProxyKey(profile('a')))
    .map(p => p.id), ['b', 'a'])
  const profiles = [profile('a', 'a1'), profile('a', 'a2'), profile('a', 'a3'), profile('b')]
  assert.deepEqual(orderProfileQueue(profiles).map(p => p.id), ['a1', 'b', 'a2', 'a3'])
  assert.deepEqual(orderProfileQueue([]), [])
})

test('equivalent proxy formats share a group, while different credentials stay separate', () => {
  const legacy = { proxy: 'host:8080:user:pass' }
  const url = { proxy: 'http://user:pass@HOST:8080' }
  assert.equal(profileProxyKey(legacy), profileProxyKey(url))
  assert.notEqual(profileProxyKey(legacy), profileProxyKey({ proxy: 'host:8080:other:pass' }))
  assert.equal(profileProxyKey({}), profileProxyKey({ proxy: 'none' }))
})
