import test from 'node:test'
import { execFileSync } from 'node:child_process'

test('reconnect uses saved credentials, deduplicates login, and preserves failed connections', () => {
  execFileSync(
    'bun',
    [
      '--eval',
      `
    import assert from 'node:assert/strict'
    import { mock } from 'bun:test'
    const account={id:'account',profileId:'profile',status:'connected',username:'source',password:'fixture-password',authenticatorKey:'fixture-key'}
    const profile={id:'profile',proxy:'fixture-proxy'}
    let fail=false, logins=0, synced=0, release
    mock.module('./server/ig-accounts/store.ts',()=>({accountById:async()=>account}))
    mock.module('./server/shared/convexClient.ts',()=>({profilesGetById:async()=>profile}))
    mock.module('./server/ig-accounts/profileName.ts',()=>({syncConnectedProfileName:async()=>{synced++}}))
    mock.module('./server/chat/instagram.ts',()=>({InstagramChat:{login:async(p,u,password,key)=>{
      assert.equal(p,profile);assert.equal(u,account.username);assert.equal(password,account.password);assert.equal(key,account.authenticatorKey)
      logins++;if(fail)throw new Error('fixture rejection');await new Promise(resolve=>release=resolve)
    }}}))
    const {reconnectAccount}=await import('./server/ig-accounts/reconnect.ts')
    const first=reconnectAccount('account');assert.equal(reconnectAccount('account'),first)
    while(!release)await new Promise(resolve=>setTimeout(resolve,0))
    release();await first;assert.equal(logins,1);assert.equal(synced,1)
    fail=true;await assert.rejects(reconnectAccount('account'),/fixture rejection/)
    assert.equal(synced,1);assert.equal(account.status,'connected')
    account.profileId=undefined;await assert.rejects(reconnectAccount('account'),/not connected/)
  `,
    ],
    { cwd: process.cwd(), stdio: 'pipe', timeout: 10_000 },
  )
})
