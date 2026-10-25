import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'
import { mouseBackFor } from './desktopPointer.js'

test('the real Cloak engine sends explicit and humanized moves through the desktop hook', () => {
  execFileSync('bun', ['--eval', `
    import assert from 'node:assert/strict'
    import { EventEmitter } from 'node:events'
    import { WebSocketServer } from 'ws'
    import { patchPage, resolveConfig } from 'cloakbrowser/human'
    import { installDesktopPointer, desktopCursorFor } from './server/browser/desktopPointer.ts'
    const events = []
    class Mouse {
      constructor(page) { this._page = page }
      async move(x, y, options) { events.push({ source: 'browser', x, y, options }) }
      async click() {} async dblclick() {} async down() {} async up() {} async wheel() {}
    }
    class Keyboard {
      async type() {} async down() {} async up() {} async press() {} async insertText() {}
    }
    class Frame {}
    class Locator {}
    class Page extends EventEmitter {
      constructor() { super(); this.mouse = new Mouse(this); this.keyboard = new Keyboard(); this.frame = new Frame() }
      mainFrame() { return this.frame }
      locator() { return new Locator() }
    }
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await new Promise(resolve => server.once('listening', resolve))
    process.env.RUNTIME_URL = 'http://127.0.0.1:' + server.address().port
    server.on('connection', socket => {
      socket.send(JSON.stringify({ ready: true }))
      socket.on('message', data => {
        events.push({ source: 'native', ...JSON.parse(data.toString()) })
        socket.send(JSON.stringify({ ready: true }))
      })
    })
    const context = new EventEmitter(), restored = new Page()
    context.pages = () => [restored]
    context.newCDPSession = async () => Object.assign(new EventEmitter(), {
      send: async () => ({ cssLayoutViewport: { clientWidth: 800, clientHeight: 600 } }), detach: async () => {},
    })
    // A persistent context may already have humanized its restored page.
    patchPage(restored, resolveConfig('careful'))
    const close = await installDesktopPointer(context, { vncPort: 6081, id: 'lease-1' })
    try {
      for (const page of [restored, new Page()]) {
        if (page !== restored) context.emit('page', page)
        events.length = 0
        await page.mouse.move(100, 200, { steps: 1 })
        assert.deepEqual(events.map(e => e.source), ['native', 'browser'])
        assert.deepEqual(events[1].options, { steps: 1 })
        events.length = 0
        await page.mouse.move(130, 210)
        assert.ok(events.length >= 2)
        assert.equal(events.length % 2, 0)
        for (let i = 0; i < events.length; i += 2) {
          assert.equal(events[i].source, 'native')
          assert.equal(events[i + 1].source, 'browser')
          assert.equal(events[i].x, events[i + 1].x)
          assert.equal(events[i].y, events[i + 1].y)
        }
        assert.deepEqual(desktopCursorFor(page), { x: 130, y: 210 })
      }
    } finally {
      close()
      for (const socket of server.clients) socket.terminate()
      await new Promise(resolve => server.close(resolve))
    }
  `], { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 10000 })
})

test('pointer bursts cache geometry briefly and refresh for resize, navigation and discrete input', () => {
  execFileSync('bun', ['--eval', `
    import { mock } from 'bun:test'
    import assert from 'node:assert/strict'
    import { EventEmitter } from 'node:events'
    import { WebSocketServer } from 'ws'
    let now = 1000, reads = 0, width = 800, detached = false, duringRead
    Date.now = () => now
    const events = [], session = new EventEmitter(), context = new EventEmitter()
    session.send = async command => {
      if (command === 'Page.enable') return {}
      assert.equal(command, 'Page.getLayoutMetrics')
      reads++
      const result = { cssLayoutViewport: { clientWidth: width, clientHeight: 600 } }
      if (duringRead) { const action = duringRead; duringRead = undefined; action() }
      return result
    }
    session.detach = async () => { detached = true }
    const page = { viewportSize: () => ({ width, height: 600 }) }
    const human = { raw: { move: async () => {} } }
    mock.module('cloakbrowser/human', () => ({ patchPage: () => human, resolveConfig: () => ({}) }))
    context.pages = () => [page]
    context.newCDPSession = async () => session
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await new Promise(resolve => server.once('listening', resolve))
    process.env.RUNTIME_URL = 'http://127.0.0.1:' + server.address().port
    server.on('connection', socket => {
      socket.send(JSON.stringify({ ready: true }))
      socket.on('message', data => {
        events.push(JSON.parse(data.toString()))
        socket.send(JSON.stringify({ ready: true }))
      })
    })
    const { installDesktopPointer, nativeWheelFor, nativeBackFor } = await import('./server/browser/desktopPointer.ts')
    const close = await installDesktopPointer(context, { vncPort: 6081, id: 'lease' })
    try {
      for (let x = 0; x < 100; x++) await human.raw.move(x, 200)
      assert.equal(reads, 1, 'rapid moves share one metrics read')
      now += 100
      await human.raw.move(100, 200)
      assert.equal(reads, 2, 'geometry expires after 100ms')
      width = 900; session.emit('Page.frameResized')
      await human.raw.move(101, 200)
      assert.equal(reads, 3)
      assert.equal(events.at(-1).width, 900)
      width = 1000; session.emit('Page.frameNavigated', {})
      await human.raw.move(102, 200)
      assert.equal(reads, 4)
      await nativeWheelFor(page)(103, 200, 'down', 1000)
      await nativeBackFor(page)(1000)
      assert.equal(reads, 6, 'wheel and Back always read fresh geometry')
      now += 100
      duringRead = () => { width = 1100; session.emit('Page.frameResized') }
      await human.raw.move(104, 200)
      assert.equal(reads, 8, 'an invalidated in-flight read is retried')
      assert.equal(events.at(-1).width, 1100)
      close()
      await Promise.resolve()
      assert.equal(detached, true)
      assert.equal(session.listenerCount('Page.frameResized'), 0)
      assert.equal(session.listenerCount('Page.frameNavigated'), 0)
      await assert.rejects(human.raw.move(105, 200), /disconnected/)
    } finally {
      close()
      for (const socket of server.clients) socket.terminate()
      await new Promise(resolve => server.close(resolve))
    }
  `], { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 5000 })
})

for (const failPress of [false, true]) test(`CDP Back mouse input always releases and detaches (${failPress})`, async () => {
  const events: unknown[] = []
  const page = { viewportSize: () => ({ width: 800, height: 600 }), context: () => ({ newCDPSession: async () => ({
    send: async (command: string, input: { type: string; button: string; buttons: number }) => {
      assert.equal(command, 'Input.dispatchMouseEvent'); assert.equal(input.button, 'back')
      events.push([input.type, input.buttons])
      if (failPress && input.type === 'mousePressed') throw new Error('Uncertain press')
    }, detach: async () => { events.push('detach') },
  }) }) } as unknown as Page
  const back = mouseBackFor(page)(5000)
  if (failPress) await assert.rejects(back, /Uncertain press/)
  else await back
  assert.deepEqual(events, [['mousePressed', 8], ['mouseReleased', 0], 'detach'])
})

test('an expired Back action never attaches CDP or sends input', async () => {
  await assert.rejects(mouseBackFor({} as Page)(0), /deadline ended/)
})

for (const action of ['wheel', 'back']) for (const reply of ['ack', 'timeout']) {
  test(`sent native ${action} waits for its socket result after the input deadline (${reply})`, () => {
    execFileSync('bun', ['--eval', `
      import { mock } from 'bun:test'
      import assert from 'node:assert/strict'
      import { EventEmitter } from 'node:events'
      import { WebSocketServer } from 'ws'
      const reply = ${JSON.stringify(reply)}
      const action = ${JSON.stringify(action)}
      const originalSetTimeout = globalThis.setTimeout, transportTimeouts = []
      globalThis.setTimeout = (fn, ms, ...args) => {
        if (ms === 5000) transportTimeouts.push(ms)
        return originalSetTimeout(fn, ms === 5000 ? 500 : ms, ...args)
      }
      const events = []
      let connection, received
      const firstReceived = new Promise(resolve => { received = resolve })
      const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
      await new Promise(resolve => server.once('listening', resolve))
      process.env.RUNTIME_URL = 'http://127.0.0.1:' + server.address().port
      server.on('connection', socket => {
        connection = socket
        socket.send(JSON.stringify({ ready: true }))
        socket.on('message', data => {
          const input = JSON.parse(data.toString())
          assert.equal(input.wheel, action === 'wheel' ? 'down' : undefined)
          assert.equal(input.back, action === 'back' ? true : undefined)
          events.push(input.x)
          if (input.x === 100) received()
          else socket.send(JSON.stringify({ ready: true }))
        })
      })
      const context = new EventEmitter(), page = { mouse: { move: async () => {} }, viewportSize: () => ({ width: 200, height: 400 }) }
      context.pages = () => [page]
      context.newCDPSession = async () => Object.assign(new EventEmitter(), {
        send: async () => ({ cssLayoutViewport: { clientWidth: 800, clientHeight: 600 } }), detach: async () => {},
      })
      mock.module('cloakbrowser/human', () => ({ resolveConfig: () => ({}), patchPage: page => ({ raw: { move: page.mouse.move } }) }))
      const { installDesktopPointer, nativeWheelFor, nativeBackFor } = await import('./server/browser/desktopPointer.ts')
      const close = await installDesktopPointer(context, { vncPort: 6081, id: 'lease-1' })
      const input = (x, timeout) => action === 'wheel' ? nativeWheelFor(page)(x, 200, 'down', timeout)
          : (page.viewportSize = () => ({ width: x * 2, height: 400 }), nativeBackFor(page)(timeout))
      try {
        let outcome = 'pending'
        const first = input(100, 200)
        const settled = first.then(() => { outcome = 'ack' }, error => { outcome = error.message })
        await firstReceived
        const expired = assert.rejects(input(200, 20), /deadline ended/)
        const next = input(300, 1000)
        const nextResult = reply === 'ack' ? next : assert.rejects(next, /disconnected/)
        void nextResult.catch(() => {})
        await new Promise(resolve => originalSetTimeout(resolve, 250))
        assert.equal(outcome, 'pending', 'a sent notch must not reject at its wheel deadline')
        assert.deepEqual(events, [100], 'the queue stays serialized until the sent request settles')
        assert.equal(connection.readyState, 1, 'wheel expiry must not terminate the shared socket')
        assert.equal(transportTimeouts.length, 2, 'handshake and sent notch both use the fixed 5-second transport timeout')
        if (reply === 'ack') connection.send(JSON.stringify({ ready: true }))
        await Promise.all([settled, expired, nextResult])
        assert.equal(outcome, reply === 'ack' ? 'ack' : 'Desktop pointer timed out')
        assert.deepEqual(events, reply === 'ack' ? [100, 300] : [100])
      } finally {
        close()
        for (const socket of server.clients) socket.terminate()
        await new Promise(resolve => server.close(resolve))
      }
    `], { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 5000 })
  })
}

for (const stalledStage of ['attach', 'metrics']) {
  test(`native wheel deadline releases the shared queue after stalled CDP ${stalledStage}`, () => {
    execFileSync('bun', ['--eval', `
      import { mock } from 'bun:test'
      import assert from 'node:assert/strict'
      import { EventEmitter } from 'node:events'
      import { WebSocketServer } from 'ws'
      const stalledStage = ${JSON.stringify(stalledStage)}
      const events = [], metricsRequests = [], unhandled = []
      process.on('unhandledRejection', error => unhandled.push(error))
      let finishStalled, rejectStalled
      const stalled = new Promise((resolve, reject) => { finishStalled = resolve; rejectStalled = reject })
      const viewport = { cssLayoutViewport: { clientWidth: 800, clientHeight: 600 } }
      const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
      await new Promise(resolve => server.once('listening', resolve))
      process.env.RUNTIME_URL = 'http://127.0.0.1:' + server.address().port
      server.on('connection', socket => {
        socket.send(JSON.stringify({ ready: true }))
        socket.on('message', data => {
          events.push(JSON.parse(data.toString()))
          socket.send(JSON.stringify({ ready: true }))
        })
      })
      const context = new EventEmitter()
      const blocked = { mouse: { move: async () => {} } }, healthy = { mouse: { move: async () => {} } }
      context.pages = () => [blocked, healthy]
      const sessionFor = page => Object.assign(new EventEmitter(), { detach: async () => {}, send: async command => {
        if (command === 'Page.enable') return {}
        assert.equal(command, 'Page.getLayoutMetrics')
        metricsRequests.push(page)
        return page === blocked && stalledStage === 'metrics' ? stalled : viewport
      } })
      context.newCDPSession = async page => page === blocked && stalledStage === 'attach' ? stalled : sessionFor(page)
      mock.module('cloakbrowser/human', () => ({ resolveConfig: () => ({}), patchPage: page => ({ raw: { move: async () => {} } }) }))
      const { installDesktopPointer, nativeWheelFor } = await import('./server/browser/desktopPointer.ts')
      const close = await installDesktopPointer(context, { vncPort: 6081, id: 'lease-1' })
      let guard
      try {
        const first = assert.rejects(nativeWheelFor(blocked)(100, 200, 'down', 60), /deadline ended/)
        const queued = assert.rejects(nativeWheelFor(healthy)(200, 200, 'down', 20), /deadline ended/)
        const next = nativeWheelFor(healthy)(300, 200, 'up', 500)
        await Promise.race([
          Promise.all([first, queued, next]),
          new Promise((_, reject) => { guard = setTimeout(() => reject(new Error('CDP kept the queue stalled')), 1000) }),
        ])
        assert.deepEqual(events.map(event => [event.x, event.wheel]), [[300, 'up']], 'no expired notch reaches the desktop')
        assert.equal(metricsRequests.filter(page => page === blocked).length, stalledStage === 'metrics' ? 1 : 0)
        assert.equal(metricsRequests.filter(page => page === healthy).length, 1, 'the expired queued notch never requests metrics')
        if (stalledStage === 'attach') finishStalled(sessionFor(blocked))
        else rejectStalled(new Error('late CDP failure'))
        await new Promise(resolve => setTimeout(resolve, 10))
        assert.equal(events.length, 1, 'late CDP completion must not emit wheel input')
        assert.equal(metricsRequests.filter(page => page === blocked).length, stalledStage === 'metrics' ? 1 : 0)
        assert.deepEqual(unhandled, [], 'late CDP rejection is consumed')
      } finally {
        clearTimeout(guard)
        close()
        for (const socket of server.clients) socket.terminate()
        await new Promise(resolve => server.close(resolve))
      }
    `], { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 5000 })
  })
}

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
        events.push(position.wheel ? 'wheel:' + position.wheel : 'native:' + position.x)
        if (timeoutMove) {
          originalSetTimeout(() => socket.send(JSON.stringify({ ready: true }), () => {}), 150)
          return
        }
        socket.send(JSON.stringify(rejectMove ? { error: 'Display session ended' } : { ready: true }))
      })
    })
    const context = new EventEmitter()
    const page = () => ({ mouse: { move: async x => { events.push('browser:' + x) },
      wheel: async () => { throw new Error('Native notches must not use pixel wheel input') } } })
    const restored = page()
    context.pages = () => [restored]
    context.newCDPSession = async () => Object.assign(new EventEmitter(), {
      send: async () => ({ cssLayoutViewport: { clientWidth: 800, clientHeight: 600 } }), detach: async () => {},
    })
    const captured = new Map()
    mock.module('cloakbrowser/human', () => ({
      resolveConfig: preset => { assert.equal(preset, 'careful'); return {} },
      patchPage: page => {
        const human = { raw: { move: page.mouse.move.bind(page.mouse) } }
        captured.set(page, (...args) => human.raw.move(...args))
        return human
      },
    }))
    const { installDesktopPointer, nativeWheelFor, desktopCursorFor } = await import('./server/browser/desktopPointer.ts')
    const close = await installDesktopPointer(context, { vncPort: 6081, id: 'lease-1' })
    try {
      await captured.get(restored)(100, 200)
      assert.deepEqual(desktopCursorFor(restored), { x: 100, y: 200 })
      const fresh = page()
      context.emit('page', fresh)
      await captured.get(fresh)(300, 400)
      assert.deepEqual(desktopCursorFor(fresh), { x: 300, y: 400 })
      assert.deepEqual(events, ['native:100', 'browser:100', 'native:300', 'browser:300'])
      await nativeWheelFor(restored)(100, 200, 'down', 5000)
      await nativeWheelFor(fresh)(300, 400, 'up', 5000)
      assert.deepEqual(events.slice(-2), ['wheel:down', 'wheel:up'], 'one request per discrete notch')
      const beforeExpiry = events.length
      await assert.rejects(nativeWheelFor(fresh)(300, 400, 'down', 0), /deadline ended/)
      assert.equal(events.length, beforeExpiry, 'expired notches do not send input')
      rejectMove = true
      await assert.rejects(nativeWheelFor(fresh)(500, 400, 'down', 5000), /Display session ended/)
      assert.equal(events.at(-1), 'wheel:down', 'native notch failures do not emit browser input')
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
      assert.equal(nativeWheelFor(restored), undefined)
      assert.equal(nativeWheelFor(fresh), undefined)
      assert.equal(desktopCursorFor(restored), undefined)
      assert.equal(desktopCursorFor(fresh), undefined)
      assert.equal(context.listenerCount('page'), 0, 'native page listener is removed')
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
