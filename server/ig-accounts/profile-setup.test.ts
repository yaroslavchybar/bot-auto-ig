import { test } from 'node:test'
import { execFileSync } from 'node:child_process'

for (const scenario of [
  'success',
  'disconnect',
  'timeout',
  'malformed reply',
  'ack missing',
  'uncertain',
  'caller stop',
  'unavailable',
]) {
  test(`browser setup lease: ${scenario}`, () => {
    execFileSync(
      'bun',
      [
        '--eval',
        `
      import {mock} from 'bun:test'
      import assert from 'node:assert/strict'
      import {WebSocketServer} from 'ws'
      const scenario=${JSON.stringify(scenario)}
      let socket,timeout,entered,finishAction,stopped=false,calls=0,connections=0
      const started=new Promise(resolve=>{entered=resolve})
      const action=new Promise(resolve=>{finishAction=resolve})
      const task={kind:'username',currentUsername:'old',value:'new'}
      const results=[]
      const server=new WebSocketServer({host:'127.0.0.1',port:0})
      await new Promise(resolve=>server.once('listening',resolve))
      server.on('connection',client=>{
        socket=client;const first=++connections===1
        client.on('message',raw=>{
          const value=JSON.parse(raw.toString())
          if(value.result){
            results.push(value.result)
            if(scenario==='ack missing')client.terminate()
            else if(value.result==='unavailable'&&!value.cancelled)client.send(JSON.stringify({ready:true,task:{...task,value:'other'}}))
            else client.send(JSON.stringify({saved:true}))
          }else client.send(JSON.stringify({ready:true,task:first?task:null}))
        })
      })
      mock.module('./server/shared/runtime.ts',()=>({runtimeUrl:()=> 'http://127.0.0.1:'+server.address().port,runtimeHeaders:()=>({})}))
      mock.module('./server/automation/actions/profile-edit.ts',()=>({editProfileInBrowser:async(_page,_task,_log,stop)=>{
        calls++;entered();await action
        if(stop())return 'failed'
        if(scenario==='uncertain')return 'uncertain'
        if(scenario==='unavailable'&&calls===1)return 'unavailable'
        return 'applied'
      }}))
      const originalTimer=globalThis.setTimeout
      globalThis.setTimeout=(fn,ms,...args)=>{if(ms===610000)timeout=fn;return originalTimer(fn,ms,...args)}
      try {
        const {setupModelInSession}=await import('./server/ig-accounts/profile-setup.ts')
        let resolved=false
        const result=setupModelInSession('p','a',{},()=>{},()=>stopped).then(value=>{resolved=true;return value})
        await started
        socket.send(JSON.stringify({ready:true,task}))
        if(scenario==='disconnect')socket.terminate()
        if(scenario==='timeout')timeout()
        if(scenario==='malformed reply')socket.send('{broken')
        if(scenario==='caller stop')stopped=true
        await Bun.sleep(10);assert.equal(resolved,false,'The browser action must stop before the caller can reuse the page')
        finishAction()
        assert.equal(await result,['success','unavailable'].includes(scenario))
        assert.equal(calls,scenario==='unavailable'?2:1)
        assert.deepEqual(results,scenario==='success'||scenario==='ack missing'?['applied']:scenario==='uncertain'?['uncertain']:scenario==='caller stop'?['failed']:scenario==='unavailable'?['unavailable','applied']:[])
      } finally {
        globalThis.setTimeout=originalTimer
        for(const client of server.clients)client.terminate()
        await new Promise(resolve=>server.close(resolve))
      }
    `,
      ],
      { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 15_000 },
    )
  })
}
