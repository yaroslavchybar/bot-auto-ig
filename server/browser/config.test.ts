import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseProxy, describeProxyLaunchError } from './config.js'

test('bare proxy strings respect the profile protocol; explicit schemes take precedence', () => {
  assert.deepEqual(parseProxy('proxy.example:1080:user:password', 'socks5'), {
    server: 'socks5://proxy.example:1080', username: 'user', password: 'password',
  })
  assert.equal(parseProxy('proxy.example:1080', 'socks5')?.server, 'socks5://proxy.example:1080')
  assert.equal(parseProxy('http://proxy.example:8080', 'socks5')?.server, 'http://proxy.example:8080')
  assert.throws(() => parseProxy('proxy.example:1080', 'invalid'), /Invalid proxy protocol/)
})

test('proxy schemes, IPv6 and encoded credentials survive parsing', () => {
  assert.deepEqual(parseProxy('socks5://proxy.example:1080'), {
    server: 'socks5://proxy.example:1080',
  })
  assert.deepEqual(parseProxy('https://u:p%40ss@proxy.example:8080'), {
    server: 'https://proxy.example:8080',
    username: 'u',
    password: 'p@ss',
  })
  assert.deepEqual(parseProxy('http://[::1]:8080'), {
    server: 'http://[::1]:8080',
  })
  assert.deepEqual(parseProxy('proxy.example:8080:u:p:extra'), {
    server: 'http://proxy.example:8080',
    username: 'u',
    password: 'p:extra',
  })
})

test('geoip lookup failure maps to profile and proxy host without credentials', () => {
  const proxy = parseProxy('proxy.example:1080:user:s3cret', 'socks5')!
  const error = describeProxyLaunchError(
    'test',
    proxy,
    new Error('Failed to get a public proxy IP address from any API endpoint.'),
  )
  assert.match(error.message, /Proxy proxy\.example:1080 for profile "test" is unreachable/)
  assert.doesNotMatch(error.message, /s3cret/)
  assert.equal(error.cause instanceof Error, true)
})

test('non-proxy launch errors pass through unchanged', () => {
  const original = new Error('Navigation failed')
  assert.equal(describeProxyLaunchError('test', undefined, original), original)
  const other = new Error('Browser closed during startup')
  assert.equal(
    describeProxyLaunchError('test', { server: 'socks5://proxy.example:1080' }, other),
    other,
  )
})
