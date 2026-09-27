import type { HttpRouter } from 'convex/server'
import { internal } from '../_generated/api'
import { jsonResponse, parseBody, registerPreflight, ValidationError, withErrorHandling } from './shared'

/** Server-only bridge. Credential values arrive encrypted and leave through the same auth gate. */
export function registerIgAccountRoutes(http: HttpRouter): void {
  const path = '/api/ig-accounts-store'
  registerPreflight(http, [path])
  http.route({ path, method: 'POST', handler: withErrorHandling(async (ctx, request) => {
    const body = await parseBody(request)
    switch (body.operation) {
      case 'list': return jsonResponse(await ctx.runQuery(internal.igAccounts.listInternal, {}))
      case 'byId': return jsonResponse(await ctx.runQuery(internal.igAccounts.byIdInternal, { id: body.id }))
      case 'byUsernameHash': return jsonResponse(await ctx.runQuery(internal.igAccounts.byUsernameHashInternal,
        { usernameHash: body.usernameHash }))
      case 'byProfile': return jsonResponse(await ctx.runQuery(internal.igAccounts.byProfileInternal,
        { profileId: body.profileId }))
      case 'available': return jsonResponse(await ctx.runQuery(internal.igAccounts.availableInternal,
        { count: body.count, cursor: body.cursor }))
      case 'connectedNames': return jsonResponse(await ctx.runQuery(internal.igAccounts.connectedNamesInternal,
        { cursor: body.cursor }))
      case 'loginProxies': return jsonResponse(await ctx.runQuery(internal.proxies.loginInternal, {}))
      case 'claimLoginProxy': return jsonResponse(await ctx.runMutation(internal.igAccounts.claimLoginProxyInternal,
        { id: body.id, loginProxyId: body.loginProxyId, token: body.token }))
      case 'releaseLoginProxy':
        await ctx.runMutation(internal.igAccounts.releaseLoginProxyInternal,
          { id: body.id, loginProxyId: body.loginProxyId, token: body.token })
        return jsonResponse({ ok: true })
      case 'modelSetupList': return jsonResponse(await ctx.runQuery(internal.igAccounts.modelSetupListInternal, {}))
      case 'modelSetupEnroll': return jsonResponse(await ctx.runMutation(internal.igAccounts.modelSetupEnrollInternal,
        { profileId: body.profileId, modelId: body.modelId, startedAt: body.startedAt }))
      case 'modelSetupPatch':
        await ctx.runMutation(internal.igAccounts.modelSetupPatchInternal,
          { profileId: body.profileId, patch: body.patch, clear: body.clear })
        return jsonResponse({ ok: true })
      case 'modelSetupReconcile': return jsonResponse(await ctx.runMutation(internal.igAccounts.modelSetupReconcileInternal,
        { profileId: body.profileId, resolution: body.resolution }))
      case 'modelSetupGroupName': return jsonResponse(await ctx.runQuery(internal.igAccounts.modelSetupGroupNameInternal,
        { modelId: body.modelId, group: body.group }))
      case 'modelSetupSaveGroupName': return jsonResponse(await ctx.runMutation(internal.igAccounts.modelSetupSaveGroupNameInternal,
        { modelId: body.modelId, group: body.group, name: body.name }))
      case 'import': return jsonResponse(await ctx.runMutation(internal.igAccounts.importEncryptedInternal,
        { rows: body.rows }))
      case 'assign':
        await ctx.runMutation(internal.igAccounts.assignInternal, { id: body.id, profileId: body.profileId })
        return jsonResponse({ ok: true })
      case 'recordBrowserLogin':
        return jsonResponse(await ctx.runMutation(internal.igAccounts.recordBrowserLoginInternal,
          { id: body.id, browserLoggedInAt: body.browserLoggedInAt,
            loginProxyId: body.loginProxyId, claimToken: body.claimToken, cooldownMs: body.cooldownMs }))
      case 'setState':
        await ctx.runMutation(internal.igAccounts.setStateInternal,
          { id: body.id, status: body.status, error: body.error, retryAfter: body.retryAfter })
        return jsonResponse({ ok: true })
      case 'setUsername':
        await ctx.runMutation(internal.igAccounts.setUsernameInternal,
          { id: body.id, usernameHash: body.usernameHash, ciphertext: body.ciphertext })
        return jsonResponse({ ok: true })
      default: throw new ValidationError('Unknown credential operation')
    }
  }) })
}
