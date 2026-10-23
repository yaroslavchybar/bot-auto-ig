import test from 'node:test'
import { execFileSync } from 'node:child_process'

test('Bun drains cookie persistence before releasing its Rust-owned session', () => {
  execFileSync(
    'bun',
    [
      '--eval',
      `
    import { mock } from 'bun:test'
    import assert from 'node:assert/strict'
    import fs from 'node:fs'
    import os from 'node:os'
    import path from 'node:path'
    import { createServer } from 'node:http'
    import { EventEmitter } from 'node:events'
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'profile-ownership-'))
    let held=false, launched=0, completeOld, enteredOld, writes=0, rejectClaim=true, bunStatusWrites=0
    const gate=new Promise(r=>completeOld=r), entered=new Promise(r=>enteredOld=r)
    const cancellation=new AbortController(), events=[]
    let row={id:'p',name:'fixture',status:'idle',inUse:false}
    const server=createServer(async(req,res)=>{
      const chunks=[]; for await(const chunk of req) chunks.push(chunk)
      const body=JSON.parse(Buffer.concat(chunks).toString()||'{}')
      res.setHeader('Content-Type','application/json')
      if(req.url.startsWith('/api/profiles/by-name')) return res.end(JSON.stringify(row))
      if(req.url==='/api/profiles/sync-status') {
        bunStatusWrites++;res.statusCode=400;return res.end('{}')
      }
      if(req.url==='/api/profiles/update-by-name') {
        if(typeof body.cookiesJson!=='string') {
          if(['status','inUse','browserSessionId'].some(key=>Object.hasOwn(body,key))) {
            bunStatusWrites++;res.statusCode=400;return res.end('{}')
          }
          Object.assign(row,body);return res.end(JSON.stringify(row))
        }
        if(body.cookiesJson.includes('old-fixture')) {enteredOld();await gate}
        assert.equal(held,true,'cookie writes must finish under the original lease')
        Object.assign(row,body); events.push(body.cookiesJson.includes('old-fixture')?'old-save':'new-save')
        return res.end(JSON.stringify(row))
      }
      res.statusCode=404;res.end('{}')
    })
    await new Promise(r=>server.listen(0,'127.0.0.1',r))
    process.env.CONVEX_URL='http://127.0.0.1:'+server.address().port
    process.env.INTERNAL_API_KEY='fixture-key'
    mock.module('./server/profiles/paths.ts',()=>({profileDirectory:()=>path.join(root,'fixture'),acquireProfileLock:async()=>{
      if(held)throw Error('Already open')
      if(rejectClaim){rejectClaim=false;throw Error('Browser ownership changed during startup')}
      held=true
      const browserSessionId='owner-'+(++writes)
      Object.assign(row,{browserSessionId,status:'running',inUse:true});events.push('running')
      return {value:{browserSessionId},release:async()=>{
        assert.equal(row.browserSessionId,browserSessionId)
        assert.equal(row.inUse,true)
        await Bun.sleep(10);row.inUse=false;row.status='idle';events.push('idle')
        held=false;events.push('released')
      }}
    }}))
    mock.module('./server/browser/budget.ts',()=>({acquireBrowserSlot:async()=>()=>{}}))
    mock.module('./server/browser/focus.ts',()=>({focusPageContent:async()=>{}}))
    mock.module('./server/browser/unreadChats.ts',()=>({saveUnreadChatsAtClose:async()=>{}}))
    mock.module('cloakbrowser',()=>({binaryInfo:()=>({}),launchPersistentContext:async()=>{
      const value=launched++===0?'old-fixture':'new-fixture', ctx=new EventEmitter()
      ctx.clearCookies=async()=>{};ctx.addCookies=async()=>{};ctx.pages=()=>[{url:()=> 'https://www.instagram.com/'}]
      ctx.cookies=async()=>[{name:'sessionid',value,domain:'.instagram.com',path:'/'}]
      ctx.close=async()=>{ctx.emit('close')};return ctx
    }}))
    const {openBrowserSession}=await import('./server/browser/cloak.ts')
    let replacement
    try {
      await assert.rejects(openBrowserSession('fixture',{headless:true}),/ownership changed/)
      assert.equal(launched,0,'a rejected native lease must prevent browser launch')
      assert.equal(held,false)
      assert.equal(writes,0,'a rejected claim must not change profile status')
      assert.deepEqual(events,[])
      const first=openBrowserSession('fixture',{headless:true,signal:cancellation.signal})
      const rejected=assert.rejects(first,/Login cancelled/)
      await entered; cancellation.abort(Error('Login cancelled'))
      // Drain scheduled cleanup work while the HTTP write is deliberately blocked.
      await new Promise(r=>setTimeout(r,25))
      assert.equal(held,true);assert.equal(row.inUse,true)
      const before=writes
      await assert.rejects(openBrowserSession('fixture',{headless:true}),/Already open/)
      assert.equal(writes,before,'a rejected contender must not publish or clear status')
      completeOld();await rejected
      assert.equal(held,false)
      assert.deepEqual(events,['running','old-save','idle','released'])
      replacement=await openBrowserSession('fixture',{headless:true})
      assert.ok(row.cookiesJson.includes('new-fixture'))
      await replacement.close();replacement=undefined
      assert.deepEqual(events.slice(-4),['running','new-save','idle','released'])
      assert.equal(bunStatusWrites,0,'only Rust may write session status')
    } finally {
      completeOld();await replacement?.close()
      await new Promise(r=>server.close(r))
      assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()))
      fs.rmSync(root,{recursive:true,force:true})
    }
  `,
    ],
    { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 15_000 },
  )
})
