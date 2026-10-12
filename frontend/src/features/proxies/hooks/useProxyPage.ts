import { useQuery } from 'convex/react'
import type { FunctionArgs } from 'convex/server'
import { api } from '../../../../../convex/_generated/api'

/** Share the paginated query while proxy options are visible. */
export function useProxyPage(args: FunctionArgs<typeof api.proxies.listPage> | 'skip') {
  return useQuery(api.proxies.listPage, args)
}
