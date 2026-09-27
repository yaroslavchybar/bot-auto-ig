import { test } from 'node:test'
import { execFileSync } from 'node:child_process'

test('scheduled mobile login uses the saved Work proxy and never reopens the browser', () => {
  execFileSync('bun', ['--eval', `
    import assert from 'node:assert/strict'
    import { mock } from 'bun:test'

    const profile = { id: 'profile', name: 'oldname', status: 'active',
      igLoggedIn: true, proxy: 'http://user:pass@work:8080', proxyType: 'http' }
    const account = { id: 'account', username: 'oldname', password: 'secret',
      authenticatorKey: 'BASE32', status: 'assigned', browserLoggedInAt: 1 }
    const events = []
    mock.module('./server/browser/cloak.ts', () => ({
      openBrowserSession: async () => { throw new Error('Browser opened twice') },
    }))
    mock.module('./server/chat/totp.ts', () => ({ freshAuthenticatorCode: async () => '123456' }))
    mock.module('./server/chat/instagram.ts', () => ({
      InstagramChat: { login: async (...args) => {
        assert.equal(args.length, 4)
        assert.equal(args[0].proxy, profile.proxy)
        assert.deepEqual(args.slice(1), ['oldname', 'secret', 'BASE32'])
        events.push('mobile')
      } },
    }))
    mock.module('./server/shared/convexClient.ts', () => ({
      profilesGetById: async () => profile, profilesList: async () => [profile],
    }))
    mock.module('./server/ig-accounts/blacklist.ts', () => ({
      blacklistProxy: async () => {}, listBlacklistedProxies: async () => [],
    }))
    mock.module('./server/ig-accounts/proxies.ts', () => ({
      listLoginProxies: async () => [], proxyExit: async () => ({}),
      savedProxyExit: async () => ({}),
    }))
    mock.module('./server/ig-accounts/store.ts', () => ({
      accountById: async () => account, accountForProfile: async () => account,
      assignAccount: async () => {}, claimLoginProxy: async () => false,
      connectedNames: async () => [],
      recordBrowserLogin: async () => ({}),
      releaseLoginProxy: async () => {}, setAccountState: async () => {},
    }))
    mock.module('./server/ig-accounts/profileName.ts', () => ({
      profileNameSyncPending: () => false,
      syncConnectedProfileName: async () => { events.push('connected') },
    }))
    mock.module('./server/ig-accounts/loginTiming.ts', () => ({
      loginProxyCooldownMs: () => 0,
    }))

    const { connectScheduledMobile } = await import('./server/ig-accounts/login.ts')
    await connectScheduledMobile(profile.id)
    assert.deepEqual(events, ['mobile', 'connected'])
  `], { stdio: 'pipe' })
})
