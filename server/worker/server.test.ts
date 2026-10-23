import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

test('private browser transport validates requests', () => {
  execFileSync(
    'bun',
    [
      '--eval',
      `
    import assert from 'node:assert/strict'
    import { createWorkerServer } from './server/worker/server.ts'
    import { ValidationError } from './server/shared/errors.ts'
    process.env.INTERNAL_API_KEY = 'fixture-key'
    const server = createWorkerServer({
      echo: ({body}) => ({body}),
      reject: () => { throw new ValidationError('fixture rejection') },
    })
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
    const base = 'http://127.0.0.1:'+server.address().port
    const headers = {Authorization:'Bearer fixture-key','Content-Type':'application/json','x-worker-params':Buffer.from(JSON.stringify({name:'Profile A'})).toString('base64url')}
    try {
      assert.equal((await fetch(base+'/health')).status,401)
      assert.equal((await fetch(base+'/commands/echo',{headers})).status,405)
      const echo=await fetch(base+'/commands/echo?cursor=a%2Bb',{method:'POST',headers,body:JSON.stringify({value:42})})
      assert.deepEqual(await echo.json(),{body:{value:42}})
      assert.equal((await fetch(base+'/commands/toString',{method:'POST',headers,body:'{}'})).status,404)
      assert.equal((await fetch(base+'/commands/echo',{method:'POST',headers,body:'invalid'})).status,400)
      assert.equal((await fetch(base+'/commands/echo',{method:'POST',headers,body:JSON.stringify('x'.repeat(1024*1024))})).status,413)
      const rejection=await fetch(base+'/commands/reject',{method:'POST',headers,body:'{}'})
      assert.equal(rejection.status,400)
      assert.equal((await rejection.json()).error.message,'fixture rejection')
    } finally { await new Promise(resolve=>server.close(resolve)) }
  `,
    ],
    { cwd: process.cwd(), stdio: 'pipe', timeout: 15_000 },
  )
})

test('worker logs one completion for finished and disconnected responses', () => {
  const output = execFileSync('bun', ['--eval', `
    import assert from 'node:assert/strict'
    import { request } from 'node:http'
    import { createWorkerServer } from './server/worker/server.ts'
    process.env.INTERNAL_API_KEY = 'fixture-key'
    let started
    const pending = new Promise(resolve => { started = resolve })
    const server = createWorkerServer({
      ok: () => ({ok:true}),
      disconnect: async ({signal}) => {
        started()
        await new Promise(resolve => signal.addEventListener('abort', resolve, {once:true}))
        assert.equal(signal.aborted,true)
        return {cancelled:true}
      },
      failed: () => { throw new Error('command failed') },
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = 'http://127.0.0.1:' + server.address().port
    const headers = {authorization:'Bearer fixture-key', 'x-request-id':'worker-request-123'}
    try {
      assert.equal((await fetch(base + '/commands/ok', {method:'POST', headers})).status, 200)
      const client = request(base + '/commands/disconnect', {method:'POST', headers})
      client.on('error', () => {})
      client.end()
      await pending
      const closed = new Promise(resolve => client.once('close', resolve))
      client.destroy()
      await closed
      assert.equal((await fetch(base + '/commands/failed', {method:'POST', headers})).status,500)
    } finally {
      await new Promise(resolve => server.close(resolve))
    }
  `], { cwd: process.cwd(), encoding: 'utf8', stdio: 'pipe', timeout: 15_000 })
  const entries = output.trim().split(/\r?\n/).map(line => JSON.parse(line))
    .filter(entry => entry.event === 'worker.command')
  assert.equal(entries.length, 3)
  const success = entries.find(entry => entry.context.operation === 'ok')
  assert.equal(success.outcome, 'success')
  assert.equal(success.context.statusCode, 200)
  const disconnected = entries.find(entry => entry.context.operation === 'disconnect')
  assert.equal(disconnected.outcome, 'cancelled')
  assert.equal(disconnected.context.responseAborted, true)
  assert.equal(disconnected.context.statusCode, undefined)
  const failed = entries.find(entry => entry.context.operation === 'failed')
  assert.equal(failed.outcome, 'error')
  assert.equal(failed.error.message, 'command failed')
  for (const entry of entries) {
    assert.equal(entry.requestId, 'worker-request-123')
    assert.equal(entry.context.method, 'POST')
  }
})
