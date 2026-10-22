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
    import { Commands } from './server/worker/commands.ts'
    import { createWorkerServer } from './server/worker/server.ts'
    import { ValidationError } from './server/shared/errors.ts'
    process.env.INTERNAL_API_KEY = 'fixture-key'
    const commands = new Commands()
    commands.register('echo','POST','/', async (req,res) => res.json({params:req.params,query:req.query,body:req.body}))
    commands.register('reject','POST','/', () => { throw new ValidationError('fixture rejection') })
    const server = createWorkerServer([commands])
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
    const base = 'http://127.0.0.1:'+server.address().port
    const headers = {Authorization:'Bearer fixture-key','Content-Type':'application/json','x-worker-params':Buffer.from(JSON.stringify({name:'Profile A'})).toString('base64url')}
    try {
      assert.equal((await fetch(base+'/health')).status,401)
      assert.equal((await fetch(base+'/commands/echo',{headers})).status,405)
      const echo=await fetch(base+'/commands/echo?cursor=a%2Bb',{method:'POST',headers,body:JSON.stringify({value:42})})
      assert.deepEqual(await echo.json(),{params:{name:'Profile A'},query:{cursor:'a+b'},body:{value:42}})
      assert.equal((await fetch(base+'/commands/echo',{method:'POST',headers,body:'invalid'})).status,400)
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
    import { Commands } from './server/worker/commands.ts'
    import { createWorkerServer } from './server/worker/server.ts'
    process.env.INTERNAL_API_KEY = 'fixture-key'
    const commands = new Commands()
    let started
    const pending = new Promise(resolve => { started = resolve })
    commands.register('ok', 'POST', '/', (_req, res) => res.json({ok:true}))
    commands.register('disconnect', 'POST', '/', (_req, _res) => { started() })
    commands.register('broken-stream', 'POST', '/', (_req, res, fail) => {
      res.write('partial')
      fail(new Error('stream failed'))
    })
    const server = createWorkerServer([commands])
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
      try { await (await fetch(base + '/commands/broken-stream', {method:'POST', headers})).text() } catch {}
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
  const failed = entries.find(entry => entry.context.operation === 'broken-stream')
  assert.equal(failed.outcome, 'error')
  assert.equal(failed.error.message, 'stream failed')
  for (const entry of entries) {
    assert.equal(entry.requestId, 'worker-request-123')
    assert.equal(entry.context.method, 'POST')
  }
})
