import test from 'node:test'
import { execFileSync } from 'node:child_process'

test('connect endpoint reconnects saved accounts without reassigning or launching a browser', () => {
  execFileSync(
    'bun',
    [
      '--eval',
      `
    import assert from 'node:assert/strict'
    import { createServer } from 'node:http'
    import { mock } from 'bun:test'
    const profile={id:'profile',igLoggedIn:false,status:'ready'}
    const account={id:'account',profileId:'profile',status:'connected'}
    let failure=false, limited=false, reconnected=0, assigned=0, queued=0, imported=0
    mock.module('./server/shared/convexClient.ts',()=>({
      profilesGetById:async id=>id===profile.id?profile:undefined,
      listsList:async()=>[],profilesCreateForModel:async()=>[],
    }))
    mock.module('./server/ig-accounts/store.ts',()=>({
      accountById:async id=>id===account.id?account:undefined,
      accountByUsername:async()=>undefined,
      assignAccount:async()=>{assigned++},availableAccounts:async()=>[],
      availableAccountCount:async()=>0,importAccounts:async()=>{imported++},
      listAccounts:async()=>[],listAccountsPage:async()=>[],
    }))
    mock.module('./server/ig-accounts/login.ts',()=>({queueProfileLogin:()=>{queued++}}))
    mock.module('./server/ig-accounts/reconnect.ts',()=>({reconnectAccount:async id=>{
      assert.equal(id,'account');reconnected++
      if(limited)throw new InstagramError('Instagram is limiting requests.',429,60_000,'IgRateLimitError')
      if(failure)throw new Error('Instagram requires verification')
    }}))
    mock.module('./server/ig-accounts/warmup.ts',()=>({listModelWarmup:async()=>[],reconcileModelWarmup:async()=>{}}))
    mock.module('./server/ig-accounts/blacklist.ts',()=>({listBlacklistedProxies:async()=>[]}))
    mock.module('./server/ig-accounts/content.ts',()=>({
      addContent:async()=>{},contentImage:async()=>{},copyImage:async()=>{},generateCopies:async()=>{},
      listContent:async()=>[],listCopies:async()=>[],removeContent:async()=>{},
    }))
    const {InstagramError}=await import('./server/chat/instagram.ts')
    const {default:commands}=await import('./server/ig-accounts/routes.ts')
    const {commandTestHandler}=await import('./server/worker/testing.ts')
    const server=createServer(commandTestHandler(commands,'/api/ig-accounts'))
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
    const base='http://127.0.0.1:'+server.address().port
    const connect=()=>fetch(base+'/api/ig-accounts/profile/connect',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credentialId:'account'}),
    })
    try {
      const success=await connect()
      assert.equal(success.status,200);assert.deepEqual(await success.json(),{ok:true})
      assert.equal(reconnected,1);assert.equal(assigned,0);assert.equal(queued,0)
      failure=true
      const rejection=await connect()
      assert.equal(rejection.status,400)
      assert.equal((await rejection.json()).error.message,'Instagram requires verification')
      assert.equal(assigned,0);assert.equal(queued,0)
      limited=true
      const rateLimit=await connect()
      assert.equal(rateLimit.status,429);assert.equal(rateLimit.headers.get('retry-after'),'60')
      assert.equal((await rateLimit.json()).error.code,'RATE_LIMITED')
      limited=false
      account.profileId='other-profile'
      assert.equal((await connect()).status,400);assert.equal(reconnected,3)
      account.profileId=undefined;account.status='available'
      assert.equal((await connect()).status,400);assert.equal(assigned,0)
      const invalidImport=await fetch(base+'/api/ig-accounts/profile/connect',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credentials:'source:password:key'}),
      })
      assert.equal(invalidImport.status,400);assert.equal(imported,0)
      profile.igLoggedIn=true
      const initial=await connect()
      assert.equal(initial.status,202);assert.equal((await initial.json()).queued,true)
      assert.equal(assigned,1);assert.equal(queued,1);assert.equal(reconnected,3)
    } finally { await new Promise(resolve=>server.close(resolve)) }
  `,
    ],
    { cwd: process.cwd(), stdio: 'pipe', timeout: 10_000 },
  )
})
