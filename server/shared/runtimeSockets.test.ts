import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

for (const scenario of [
  'lease',
  'already aborted',
  'pending initial',
  'active subscription',
  'reconnect',
  'stalled handshake',
])
  test(`runtime sockets preserve resource ownership and cancellation: ${scenario}`, () => {
    const result = spawnSync(
      process.execPath,
      [
        '--eval',
        `
      import assert from 'node:assert/strict'
      import { getEventListeners, once } from 'node:events'
      import { createServer } from 'node:http'
      import { WebSocketServer } from 'ws'
      const scenario = ${JSON.stringify(scenario)}
      const http = createServer()
      const connections = new Set()
      http.on('connection', socket => { connections.add(socket); socket.on('close', () => connections.delete(socket)) })
      await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
      process.env.RUNTIME_URL = 'http://127.0.0.1:' + http.address().port
      process.env.INTERNAL_API_KEY = 'fixture-key'
      const { nativeLease } = await import('./server/shared/runtimeSockets.ts')
      const { watchRoutineRuntime, watchRoutineAccess, watchProfileAccess, closeConvexRealtime } = await import('./server/shared/convexRealtime.ts')
      const server = scenario === 'stalled handshake' ? undefined : new WebSocketServer({server:http})
      if (!server) http.on('upgrade', () => {})
      const sockets = []
      const messages = []
      server?.on('connection', (socket, request) => {
        assert.equal(request.headers.authorization, 'Bearer fixture-key')
        sockets.push(socket)
        socket.on('message', data => {
          messages.push(JSON.parse(data.toString()))
          if (scenario === 'active subscription') socket.send(JSON.stringify({value:true}))
        })
      })
      async function until(check) {
        for (let i = 0; !check(); i++) { assert.ok(i < 100, 'socket event did not arrive'); await Bun.sleep(10) }
      }
      const controller = new AbortController()
      const reason = new Error('Stopped fixture')
      let updates = 0, errors = 0, lost = 0
      try {
        if (scenario === 'lease') {
          let granted = false
          const pending = nativeLease('/browser/lease', {profileName:'fixture'}, controller.signal, () => lost++)
          void pending.then(() => { granted = true })
          await until(() => messages.length === 1)
          assert.equal(granted, false, 'an open socket must not grant a queued resource')
          assert.deepEqual(messages, [{profileName:'fixture'}])
          sockets[0].send(JSON.stringify({ready:true}))
          const lease = await pending
          assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
          controller.abort(reason)
          assert.equal(sockets[0].readyState, 1, 'the granted resource lives until release')
          const closed = once(sockets[0], 'close')
          lease.release()
          await closed
          assert.equal(lost, 0)
        } else if (scenario === 'stalled handshake') {
          const safety = AbortSignal.timeout(8000)
          const lease = nativeLease('/browser/lease', undefined, safety, () => lost++)
          const sub = watchProfileAccess('p', () => updates++, () => errors++, safety)
          try {
            const results = await Promise.allSettled([lease, sub.initial])
            assert.ok(results.every(result => result.status === 'rejected' && /connection failed/.test(result.reason.message)))
            assert.equal(safety.aborted, false, 'the handshake deadline must fire before caller cancellation')
            assert.equal(updates, 0)
            assert.equal(lost, 0)
          } finally { sub.unsubscribe() }
        } else {
          if (scenario === 'already aborted') controller.abort(reason)
          const factories = [
            (update,error,signal) => watchRoutineRuntime('a',['m'],update,error,signal),
            (update,error,signal) => watchRoutineAccess('a','p',update,error,signal),
            (update,error,signal) => watchProfileAccess('p',update,error,signal),
          ]
          const subscriptions = factories.map(factory => factory(() => updates++, () => errors++, controller.signal))
          const settled = Promise.all(subscriptions.map(sub => sub.initial.catch(error => error)))
          if (scenario === 'already aborted') assert.equal(sockets.length, 0)
          else {
            await until(() => messages.length === 3)
            if (scenario === 'active subscription') assert.deepEqual(await settled, [true,true,true])
            if (scenario === 'reconnect') {
              for (const socket of sockets) socket.terminate()
              await settled
            }
            controller.abort(reason)
          }
          const initial = await settled
          if (scenario !== 'active subscription' && scenario !== 'reconnect') assert.ok(initial.every(value => value === reason))
          if (scenario === 'reconnect') await Bun.sleep(1100)
          await Bun.sleep(20)
          assert.equal(sockets.length, scenario === 'already aborted' ? 0 : 3)
          assert.equal(updates, scenario === 'active subscription' ? 3 : 0)
          assert.equal(errors, scenario === 'reconnect' ? 3 : 0)
          assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
          for (const sub of subscriptions) sub.unsubscribe()
        }
      } finally {
        await closeConvexRealtime()
        for (const socket of server?.clients ?? []) socket.terminate()
        for (const socket of connections) socket.destroy()
        if (server) await new Promise(resolve => server.close(resolve))
        await new Promise(resolve => http.close(resolve))
      }
    `,
      ],
      { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 12000 },
    )
    assert.equal(result.status, 0, result.stderr)
  }, 15000)
