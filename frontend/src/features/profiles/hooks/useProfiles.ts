import { useCallback, useMemo } from 'react'
import { useConvex, useQuery } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import { mapProfileRecord } from '../utils/mapProfile'

export function useProfiles() {
  const convex = useConvex()
  const data = useQuery(api.profiles.queries.list, {})
  const profiles = useMemo(() => data ? data.map(mapProfileRecord) : [], [data])
  const refresh = useCallback(async () => { await convex.query(api.profiles.queries.list, {}) }, [convex])
  return { profiles, loading: data === undefined, refresh }
}
