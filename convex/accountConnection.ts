import type { Doc } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'

/** Assignment is stored; the linked profile owns the current browser connection. */
export function connectionStatus(account: Doc<'igAccounts'>, profile: Doc<'profiles'> | null) {
  if (!account.profileId || !['assigned', 'connected'].includes(account.status))
    return account.status
  const connected =
    profile?._id === account.profileId &&
    profile.igLoggedIn &&
    (!profile.igAccountId || profile.igAccountId === account._id)
  return connected ? ('connected' as const) : ('assigned' as const)
}

export async function withConnectionStatus(ctx: QueryCtx, account: Doc<'igAccounts'>) {
  const profile = account.profileId ? await ctx.db.get(account.profileId) : null
  return { ...account, status: connectionStatus(account, profile) }
}
