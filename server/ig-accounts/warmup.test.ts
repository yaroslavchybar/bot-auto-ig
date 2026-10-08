import { test } from 'node:test'
import { execFileSync } from 'node:child_process'

for (const scenario of ['disconnect', 'timeout', 'malformed reply', 'success', 'uncertain', 'caller stop']) {
  test(`browser post lease: ${scenario}`, () => {
    execFileSync('bun', ['--eval', `
      import { mock } from 'bun:test'
      import assert from 'node:assert/strict'
      import { WebSocketServer } from 'ws'
      import { promises as fs } from 'node:fs'
      import { tmpdir } from 'node:os'
      import path from 'node:path'
      const scenario = ${JSON.stringify(scenario)}
      const root = await fs.mkdtemp(path.join(tmpdir(), 'ig-post-test-'))
      const image = path.join(root, 'image.jpg')
      await fs.writeFile(image, 'fixture')
      let socket, timeout, entered, finishAction, callerStopped = false, mutations = 0, calls = 0
      const started = new Promise(resolve => { entered = resolve })
      const action = new Promise(resolve => { finishAction = resolve })
      const results = []
      const server = new WebSocketServer({host:'127.0.0.1',port:0})
      await new Promise(resolve => server.once('listening', resolve))
      server.on('connection', client => {
        socket = client
        client.on('message', raw => {
          const value = JSON.parse(raw.toString())
          if ('result' in value) {
            results.push(value.result)
            client.send(JSON.stringify({saved:true}))
          } else client.send(JSON.stringify({ready:true, content:{sourceId:'s',path:image}}))
        })
      })
      mock.module('./server/shared/runtime.ts', () => ({ runtimeUrl: () => 'http://127.0.0.1:'+server.address().port, runtimeHeaders: () => ({}) }))
      mock.module('./server/shared/logger.ts', () => ({ default: { error() {} } }))
      mock.module('./server/automation/actions/publish.ts', () => ({ publishFeedPost: async (_page, _image, log, stopped) => {
        calls++; entered(); await action
        if (stopped()) return false
        if (scenario === 'uncertain') { log({event:'fixture', message:'Post publish failed: share did not confirm'}); return false }
        mutations++; return true
      } }))
      const originalTimer = globalThis.setTimeout
      globalThis.setTimeout = (fn, ms, ...args) => {
        if (ms === 610000) timeout = fn
        return originalTimer(fn, ms, ...args)
      }
      try {
        const { postModelUpdateInSession } = await import('./server/ig-accounts/warmup.ts')
        let resolved = false
        const result = postModelUpdateInSession('p', 'm', {}, () => {}, () => callerStopped).then(value => { resolved = true; return value })
        await started
        socket.send(JSON.stringify({ready:true,content:{sourceId:'s',path:image}}))
        if (scenario === 'disconnect') socket.terminate()
        if (scenario === 'timeout') timeout()
        if (scenario === 'malformed reply') socket.send('{broken')
        if (scenario === 'caller stop') callerStopped = true
        await Bun.sleep(10)
        assert.equal(resolved, false, 'the caller must wait for the browser action to finish')
        finishAction()
        assert.equal(await result, scenario === 'success')
        assert.equal(calls, 1, 'duplicate ready frames cannot launch a second post')
        assert.equal(mutations, scenario === 'success' ? 1 : 0)
        assert.deepEqual(results, scenario === 'success' ? ['shared'] : scenario === 'uncertain' ? ['uncertain'] : scenario === 'caller stop' ? ['failed'] : [])
      } finally {
        globalThis.setTimeout = originalTimer
        for (const client of server.clients) client.terminate()
        await new Promise(resolve => server.close(resolve))
        if(path.dirname(path.resolve(root)) !== path.resolve(tmpdir())) throw Error('Invalid fixture root')
        await fs.rm(root, {recursive:true,force:true})
      }
    `], { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 15_000 })
  })
}
