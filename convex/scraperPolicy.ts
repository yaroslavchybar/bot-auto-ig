import type { Doc, Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'

export const DAY = 86_400_000
export const scraperBusy = (profile: Pick<Doc<'profiles'>, 'using' | 'status'>) =>
  profile.using || profile.status === 'running'

/** Worker subscriptions read only the metadata kept in sync by profile/session writes. */
export async function scraperProfiles(ctx: Pick<QueryCtx, 'db'>) {
  const rows = await ctx.db.query('scraperProfiles').collect()
  return rows.map(({ _id: _rowId, _creationTime: _created, profileId, ...fields }) => ({
    ...fields,
    _id: profileId as Id<'profiles'>,
  }))
}

export function capacityAt(profile: Pick<Doc<'profiles'>, 'scraperCooldownUntil'>) {
  return profile.scraperCooldownUntil ?? 0
}
