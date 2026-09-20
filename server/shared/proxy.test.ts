import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeProxy, parseProxy, proxyKey } from './proxy.js'
import { maskProxyForDisplay } from '../../frontend/src/features/proxies/utils/maskProxy.ts'
import { buildProxyUsage } from '../../frontend/src/features/proxies/utils/proxyUsage.ts'
import { formatProxyForInput } from '../../frontend/src/features/proxies/utils/formatProxyForInput.ts'

test('provider input format preserves connection details through editing', () => {
  for (const [raw, protocol, expected] of [
    ['socks5://user:pass@host:5432', 'socks5', 'host:5432:user:pass'],
    ['http://user:p%40ss%3Abad@host', 'http', 'host:80:user:p@ss:bad'],
    ['https://host', 'https', 'host:443'],
    ['socks5://user:pass@[::1]:1080', 'socks5', '[::1]:1080:user:pass'],
    ['host:5432:user:pass', 'socks5', 'host:5432:user:pass'],
    ['http://user%3Aname:pass@host', 'http', 'http://user%3Aname:pass@host'],
  ]) {
    assert.equal(formatProxyForInput(raw, protocol), expected)
    assert.deepEqual(parseProxy(expected, protocol), parseProxy(raw, protocol))
  }
  assert.equal(formatProxyForInput(undefined), '')
  assert.equal(formatProxyForInput('host:bad'), 'host:bad')
})

test('all consumers agree on canonical identity and default ports', () => {
  for (const [a, b] of [
    ['host:8080:user:p@ss:bad', 'http://user:p%40ss%3Abad@HOST:8080/'],
    ['http://HOST:80', 'http://host/'],
    ['https://HOST:443', 'https://host'],
    ['socks5://HOST:1080', 'socks5://host'],
    ['http://[::1]:8080:user:pass', 'http://user:pass@[::1]:8080'],
  ]) {
    assert.equal(proxyKey(a), proxyKey(b))
    assert.deepEqual(parseProxy(a), parseProxy(normalizeProxy(a).proxy))
    assert.equal(buildProxyUsage([{ id: 'p', proxy: a, proxyType: 'http' }], [{ name: 'A', proxy: b }]).p.count, 1)
  }
})

test('display never returns passwords for legacy, URL, or malformed values', () => {
  for (const raw of ['host:8080:user:p@ss:bad', 'http://user:p%40ss%3Abad@host:8080', 'http://user:p@ss:bad@host:bad']) {
    assert.doesNotMatch(maskProxyForDisplay(raw), /p@ss|p%40ss/)
  }
  assert.equal(maskProxyForDisplay('host:8080:user:p@ss:bad'), 'host:8080 (•••)')
  assert.equal(maskProxyForDisplay('http://[::1]:8080'), '[::1]:8080')
})

test('invalid input fails safely and never becomes a direct connection', () => {
  for (const raw of ['http://user:secret@host:bad', 'ftp://host', 'host:0:user:secret', 'host:70000:user:secret']) {
    assert.throws(() => parseProxy(raw), { message: 'Invalid proxy protocol or URL' })
    assert.equal(proxyKey(raw), null)
  }
  assert.equal(parseProxy('none'), undefined)
  assert.equal(parseProxy(''), undefined)
})
