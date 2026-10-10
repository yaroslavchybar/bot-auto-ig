import { useEffect } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { toast } from 'sonner'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'

/** Older lists get a bounded, one-time count backfill when first displayed. */
export function useLeadListSummary(listId: Id<'leadLists'>, visible = true) {
  const counts = useQuery(api.scrapeSources.summary, visible ? { listId } : 'skip')
  const ensureCount = useMutation(api.leads.ensureCount)
  const needsCount = visible && counts?.leads === null
  useEffect(() => {
    if (needsCount) void ensureCount({ listId }).catch(() => toast.error('Could not load list count'))
  }, [needsCount, ensureCount, listId])
  return counts
}
