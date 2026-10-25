import { test } from 'node:test'
import { execFileSync } from 'node:child_process'

for (const kind of ['setup', 'post']) for (const stage of ['before connect', 'waiting', 'during action', 'awaiting acknowledgement', 'ack timeout', 'already stopped', ...(kind === 'setup' ? ['next candidate action'] : [])])
  for (const outcome of ['during action', 'awaiting acknowledgement'].includes(stage) ? ['failed', 'confirmed', 'uncertain', ...(kind === 'setup' ? ['unavailable'] : [])] : ['failed']) {
  test(`${kind} lease cancellation: ${stage} (${outcome})`, () => {
    execFileSync('bun', ['--eval', `
      import {mock} from 'bun:test'
      import {createServer} from 'node:http'
      import {WebSocketServer} from 'ws'
      import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
      import {tmpdir} from 'node:os'
      import path from 'node:path'
      import assert from 'node:assert/strict'
      const kind=${JSON.stringify(kind)},stage=${JSON.stringify(stage)},outcome=${JSON.stringify(outcome)}
      const actionStages=['during action','awaiting acknowledgement','ack timeout','next candidate action']
      const controller=new AbortController()
      const root=mkdtempSync(path.join(tmpdir(),'ig-lease-cancel-'))
      const image=path.join(root,'fixture.jpg');writeFileSync(image,'fixture')
      let socket,finishAction,entered,connected,received,receiveCancel,save,ackTimeout,calls=0,cancellations=0
      const cancelReceived=new Promise(resolve=>{receiveCancel=resolve})
      const results=[]
      const receivedResult=new Promise(resolve=>{received=resolve})
      const saving=new Promise(resolve=>{save=resolve})
      const waiting=new Promise(resolve=>{connected=resolve})
      const started=new Promise(resolve=>{entered=resolve})
      const action=new Promise(resolve=>{finishAction=resolve})
      const http=createServer(),connections=new Set()
      http.on('connection',socket=>{connections.add(socket);socket.on('close',()=>connections.delete(socket))})
      await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve))
      const server=stage==='before connect'?undefined:new WebSocketServer({server:http})
      if(!server)http.on('upgrade',()=>connected())
      server?.on('connection',client=>{
        socket=client
        client.on('message',raw=>{
          const value=JSON.parse(raw.toString())
          if(value.cancel){
            cancellations++;receiveCancel()
            void saving.then(()=>{
              if(client.readyState!==1)return
              if(stage==='waiting')client.send(JSON.stringify(kind==='setup'
                ? {ready:true,task:{kind:'username',value:'late'}}
                : {ready:true,content:{sourceId:'source',path:image}}))
              client.send(JSON.stringify({saved:true}))
            })
          }else if(value.result){
            results.push(value)
            if(stage==='next candidate action'&&value.result==='unavailable'){
              client.send(JSON.stringify({ready:true,task:{kind:'username',value:'next-candidate'}}));return
            }
            received()
            void saving.then(()=>{if(client.readyState===1)client.send(JSON.stringify(kind==='setup'&&stage==='awaiting acknowledgement'&&value.result==='unavailable'
              ? {ready:true,task:{kind:'username',value:'next-candidate'}} : {saved:true}))})
          }
          else if(actionStages.includes(stage))client.send(JSON.stringify(kind==='setup'
            ? {ready:true,task:{kind:'username',value:'new'}}
            : {ready:true,content:{sourceId:'source',path:image}}))
          else connected()
        })
      })
      mock.module('./server/shared/runtime.ts',()=>({runtimeUrl:()=> 'http://127.0.0.1:'+http.address().port,runtimeHeaders:()=>({})}))
      mock.module('./server/shared/logger.ts',()=>({default:{error(){}}}))
      mock.module('./server/automation/actions/profile-edit.ts',()=>({editProfileInBrowser:async()=>{
        calls++
        if(stage==='next candidate action'&&calls===1)return 'unavailable'
        entered();await action;return outcome==='confirmed'?'applied':outcome
      }}))
      mock.module('./server/automation/actions/publish.ts',()=>({publishFeedPost:async(_p,_image,log)=>{
        calls++;entered();await action
        if(outcome==='uncertain')log({message:'share did not confirm'})
        return outcome==='confirmed'
      }}))
      const originalTimer=globalThis.setTimeout
      globalThis.setTimeout=(fn,ms,...args)=>{if(ms===10000)ackTimeout=fn;return originalTimer(fn,ms,...args)}
      if(stage==='already stopped')controller.abort()
      const run=kind==='setup'
        ? (await import('./server/ig-accounts/profile-setup.ts')).setupModelInSession
        : (await import('./server/ig-accounts/warmup.ts')).postModelUpdateInSession
      let resolved=false
      const result=run('profile','model',{},()=>{},()=>false,controller.signal).then(value=>{resolved=true;return value})
      try{if(stage==='already stopped'){
        assert.equal(await result,false);assert.equal(socket,undefined)
      }else{
        if(actionStages.includes(stage))await started
        else await waiting
        if(stage==='awaiting acknowledgement'){finishAction();await receivedResult}
        controller.abort(new Error('Stopped'))
        if(stage==='waiting'||stage==='awaiting acknowledgement'){
          await cancelReceived
          assert.equal(cancellations,1)
          await Bun.sleep(10)
          assert.equal(resolved,false,'Cancellation during preparation must await durable cleanup')
          if(stage==='waiting')save()
        }
        if(stage==='during action'||stage==='ack timeout'||stage==='next candidate action'){
          await Bun.sleep(0)
          assert.equal(resolved,false,'Retain page ownership until input stops')
          assert.equal(socket.readyState,1)
          assert.equal(ackTimeout,undefined,'Acknowledgement deadline starts after the active action stops')
          finishAction()
        }
        if(actionStages.includes(stage)){
          await receivedResult
          assert.equal(results.length,stage==='next candidate action'?2:1)
          assert.equal(results.at(-1).result,outcome==='confirmed'?(kind==='setup'?'applied':'shared'):outcome)
          await Bun.sleep(10)
          assert.equal(resolved,false,'Durable acknowledgement must arrive before release')
          if(stage==='ack timeout')ackTimeout()
          else save()
        }
        assert.equal(await result,false)
        assert.equal(calls,stage==='next candidate action'?2:actionStages.includes(stage)?1:0)
        if(kind==='setup'&&stage==='awaiting acknowledgement'&&outcome==='unavailable')
          assert.deepEqual(results.map(value=>value.result),['unavailable'])
      }}finally{
        globalThis.setTimeout=originalTimer
        for(const client of server?.clients??[])client.terminate()
        for(const connection of connections)connection.destroy()
        await new Promise(resolve=>http.close(resolve))
        assert.equal(path.dirname(path.resolve(root)),path.resolve(tmpdir()))
        rmSync(root,{recursive:true,force:true})
      }
    `], { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 15_000 })
  })
}
