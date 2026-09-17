import { useMemo } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import type { ProxyItem } from '../types'
import { DEFAULT_MAX_PROFILES } from '../utils/proxyUsage'

export function useProxies() {
  const data = useQuery(api.proxies.list, {})
  const proxies = useMemo<ProxyItem[]>(
    () =>
      data
        ? data.map((row) => ({
            id: String(row._id),
            name: row.name,
            proxy: row.proxy,
            proxyType: row.proxyType,
            maxProfiles:
              typeof row.maxProfiles === 'number' && row.maxProfiles >= 1
                ? Math.floor(row.maxProfiles)
                : DEFAULT_MAX_PROFILES,
          }))
        : [],
    [data],
  )
  return { proxies, loading: data === undefined }
}
