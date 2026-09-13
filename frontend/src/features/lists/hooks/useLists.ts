import { useMemo } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'

export function useLists() {
  const data = useQuery(api.lists.list, {})
  const lists = useMemo(() => data ? data.map(list => ({ id: String(list._id), name: list.name })) : [], [data])
  return { lists, loading: data === undefined }
}
