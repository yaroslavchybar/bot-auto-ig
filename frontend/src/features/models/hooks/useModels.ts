import { useMemo } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'

export function useModels() {
  const data = useQuery(api.models.list, {})
  const models = useMemo(
    () =>
      data
        ? data.map((model) => ({
            id: String(model._id),
            name: model.name,
            baseFullName: model.baseFullName,
            fullNameVariations: model.fullNameVariations,
            usernames: model.usernames,
          }))
        : [],
    [data],
  )
  return { models, loading: data === undefined }
}
