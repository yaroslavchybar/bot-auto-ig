import { test } from 'node:test'
import { execFileSync } from 'node:child_process'

for (const ending of ['close', 'timeout']) {
  test(`native moves precede browser events and fail closed after ${ending}`, () => {
    execFileSync(
      'bun',
      [
        '--eval',
        `
    import { mock } from 'bun:test'
    import assert from 'node:assert/strict'
    import { EventEmitter } from 'node:events'
    import { WebSocketServer } from 'ws'
    const ending = ${JSON.stringify(ending)}
    const originalSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = (fn, ms, ...args) => originalSetTimeout(fn, ms === 5000 ? 100 : ms, ...args)
    const events = []
    let connection, rejectMove = false, timeoutMove = false
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await new Promise(resolve => server.once('listening', resolve))
    process.env.RUNTIME_URL = 'http://127.0.0.1:' + server.address().port
    server.on('connection', (socket, req) => {
      assert.equal(req.url, '/displays/6081/pointer')
      assert.equal(req.headers['x-display-id'], 'lease-1')
      connection = socket
      socket.send(JSON.stringify({ ready: true }))
      socket.on('message', data => {
        const position = JSON.parse(data.toString())
        assert.equal(position.width, 800)
        assert.equal(position.height, 600)
        events.push('native:' + position.x)
        if (timeoutMove) {
          originalSetTimeout(() => socket.send(JSON.stringify({ ready: true }), () => {}), 150)
          return
        }
        socket.send(JSON.stringify(rejectMove ? { error: 'Display session ended' } : { ready: true }))
      })
    })
    const context = new EventEmitter()
    const page = () => ({ mouse: { move: async x => { events.push('browser:' + x) } } })
    const restored = page()
    context.pages = () => [restored]
    context.newCDPSession = async () => ({ send: async () => ({ cssLayoutViewport: { clientWidth: 800, clientHeight: 600 } }) })
    const captured = new Map()
    mock.module('cloakbrowser/human', () => ({
      resolveConfig: preset => { assert.equal(preset, 'careful'); return {} },
      patchContext: context => {
        for (const page of context.pages()) captured.set(page, page.mouse.move.bind(page.mouse))
        context.on('page', page => captured.set(page, page.mouse.move.bind(page.mouse)))
      },
    }))
    const { installDesktopPointer } = await import('./server/browser/desktopPointer.ts')
    const close = await installDesktopPointer(context, { vncPort: 6081, id: 'lease-1' })
    try {
      await captured.get(restored)(100, 200)
      const fresh = page()
      context.emit('page', fresh)
      await captured.get(fresh)(300, 400)
      assert.deepEqual(events, ['native:100', 'browser:100', 'native:300', 'browser:300'])
      rejectMove = true
      await assert.rejects(captured.get(fresh)(500, 400), /Display session ended/)
      assert.equal(events.at(-1), 'native:500', 'failed native moves must not click elsewhere')
      const disconnected = new Promise(resolve => connection.once('close', resolve))
      if (ending === 'timeout') {
        timeoutMove = true
        const timedOut = captured.get(fresh)(600, 400)
        const queued = captured.get(fresh)(650, 400)
        await Promise.all([
          assert.rejects(timedOut, /timed out/),
          assert.rejects(queued, /disconnected/),
        ])
        assert.equal(events.at(-1), 'native:600', 'queued moves must not consume a stale reply')
        await Promise.race([
          disconnected,
          new Promise((_, reject) => originalSetTimeout(() => reject(new Error('Timed-out socket stayed open')), 500)),
        ])
      } else {
        close()
        await disconnected
      }
      close()
      assert.equal(context.listenerCount('page'), 1, 'native page listener is removed')
      const sent = events.length
      await assert.rejects(captured.get(fresh)(700, 400), /disconnected/)
      assert.equal(events.length, sent, 'later requests must not send or move the browser pointer')
    } finally {
      close()
      for (const socket of server.clients) socket.terminate()
      await new Promise(resolve => server.close(resolve))
    }
  `,
      ],
      { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 15_000 },
    )
  })
}
