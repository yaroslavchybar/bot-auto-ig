import test from 'node:test'
import { execFileSync } from 'node:child_process'

test('Axum manifest matches worker commands and private transport validates requests', () => {
  execFileSync(
    'bun',
    [
      '--eval',
      `
    import assert from 'node:assert/strict'
    import fs from 'node:fs'
    import { profilesRouter } from './server/profiles/index.ts'
    import { automationsRouter } from './server/automations/index.ts'
    import displays from './server/displays/routes.ts'
    import chat from './server/chat/routes.ts'
    import accounts from './server/ig-accounts/routes.ts'
    import { Commands } from './server/worker/commands.ts'
    import { createWorkerServer } from './server/worker/server.ts'
    import { ValidationError } from './server/shared/errors.ts'
    const groups = [['profiles', profilesRouter], ['automations', automationsRouter], ['displays', displays], ['chat', chat], ['ig-accounts', accounts]]
    const actual = groups.flatMap(([prefix, group]) => group.operations.map(({id,method,path,body}) => ({id,method,path:'/api/'+prefix+(path==='/'?'':path),body})))
    const manifest = JSON.parse(fs.readFileSync('tools/runtime/src/api/worker-routes.json','utf8')).map(({id,method,path,body}) => ({id,method,path,body}))
    assert.deepEqual(actual.sort((a,b)=>a.id.localeCompare(b.id)), manifest.sort((a,b)=>a.id.localeCompare(b.id)))
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
