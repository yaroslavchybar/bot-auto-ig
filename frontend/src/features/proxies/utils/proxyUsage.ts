import { proxyKey as proxyUsageKey } from '../../../../../server/shared/proxy'
export { proxyKey as proxyUsageKey } from '../../../../../server/shared/proxy'

// Matches profiles to saved proxies. Both sides store the proxy as a
// plain string, so a profile belongs to a proxy when the normalized
// "type://value" keys match.

export const DEFAULT_MAX_PROFILES = 3

export type ProxyUsage = {
  count: number
  profileNames: string[]
}

export function buildProxyUsage(
  proxies: Array<{ id: string; proxy: string; proxyType: string }>,
  profiles: Array<{ name: string; proxy?: string; proxyType?: string }>,
): Record<string, ProxyUsage> {
  const usage: Record<string, ProxyUsage> = {}
  for (const proxy of proxies) {
    usage[proxy.id] = { count: 0, profileNames: [] }
  }
  for (const profile of profiles) {
    const key = proxyUsageKey(profile.proxy, profile.proxyType)
    if (!key) continue
    for (const proxy of proxies) {
      if (proxyUsageKey(proxy.proxy, proxy.proxyType) === key) {
        usage[proxy.id]!.count += 1
        usage[proxy.id]!.profileNames.push(profile.name)
      }
    }
  }
  for (const entry of Object.values(usage)) {
    entry.profileNames.sort((a, b) => a.localeCompare(b))
  }
  return usage
}
