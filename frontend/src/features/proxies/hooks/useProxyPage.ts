import { useEffect } from 'react'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionArgs } from 'convex/server'
import { toast } from 'sonner'
import { api } from '../../../../../convex/_generated/api'

/** Share the query and start the one-time usage backfill only while options are visible. */
export function useProxyPage(args: FunctionArgs<typeof api.proxies.listPage> | 'skip') {
  const data = useQuery(api.proxies.listPage, args)
  const ensureUsage = useMutation(api.proxyUsage.ensure)
  const needsUsage = data?.usageReady === false
  useEffect(() => {
    if (needsUsage)
      void ensureUsage({}).catch(() => toast.error('Could not initialize proxy usage'))
  }, [needsUsage, ensureUsage])
  return data
}
