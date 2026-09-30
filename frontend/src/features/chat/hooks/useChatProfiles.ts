import { useMemo } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'

export function useChatProfiles() {
  const rows = useQuery(api.profiles.queries.chatOptions, {})
  const profiles = useMemo(
    () =>
      (rows ?? []).map((row) => ({
        id: String(row._id),
        name: row.name,
        status: row.status,
        igLoggedIn: true,
      })),
    [rows],
  )
  return { profiles, loading: rows === undefined }
}
