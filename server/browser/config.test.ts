import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseProxy, normalizeFingerprintScreen } from './config.js'

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

test('fingerprint screen is locked to window size', () => {
  const fp: any = { screen: { width: 3840, height: 1080, outerWidth: 100, innerHeight: 10 } }
  normalizeFingerprintScreen(fp)
  assert.equal(fp.screen.width, 1366)
  assert.equal(fp.screen.height, 768)
  assert.equal(fp.screen.availWidth, 1366)
  assert.equal(fp.screen.availHeight, 768)
  assert.equal(fp.screen.outerWidth, 1366)
  assert.equal(fp.screen.outerHeight, 768)
  assert.equal(fp.screen.innerWidth, 1366)
  assert.equal(fp.screen.innerHeight, 768)
})
