import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { prepareBrowserProxy } from './proxy.js'

test('direct, HTTP and unauthenticated SOCKS5 connections need no relay', async () => {
  for (const proxy of [undefined, { server: 'http://example.com:8080', username: 'u', password: 'p' }, { server: 'socks5://example.com:1080' }]) {
    const prepared = await prepareBrowserProxy(proxy)
    assert.equal(prepared.proxy, proxy)
    await prepared.close()
  }
})

test('authenticated SOCKS5 gets a loopback relay that closes idempotently', async () => {
  const prepared = await prepareBrowserProxy({ server: 'socks5://example.com:1080', username: 'u', password: 'p' })
  const url = new URL(prepared.proxy!.server)
  assert.equal(url.hostname, '127.0.0.1')
  assert.equal(url.protocol, 'http:')
  assert.equal('username' in prepared.proxy!, false)
  await prepared.close()
  await prepared.close()
  await new Promise<void>((resolve, reject) => {
    const socket = net.connect(Number(url.port), url.hostname)
    socket.once('connect', () => { socket.destroy(); reject(new Error('Relay still listening')) })
    socket.once('error', (error: NodeJS.ErrnoException) => {
      try { assert.equal(error.code, 'ECONNREFUSED'); resolve() } catch (error) { reject(error) }
    })
  })
})
