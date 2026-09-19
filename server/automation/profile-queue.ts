import { parseProxy } from '../browser/config.js'

type ProxyProfile = { proxy?: string; proxyType?: string }

export function profileProxyKey(profile: ProxyProfile): string {
  try {
    const proxy = parseProxy(profile.proxy, profile.proxyType)
    if (!proxy) return 'direct'
    return JSON.stringify([new URL(proxy.server).href, proxy.username ?? '', proxy.password ?? ''])
  } catch {
    // Leave invalid proxy handling to browser startup for the affected profile.
    return JSON.stringify([profile.proxyType, profile.proxy?.trim()])
  }
}

/** Interleave the largest remaining proxy groups, preserving order within each group. */
export function orderProfileQueue<T extends ProxyProfile>(profiles: readonly T[], previousProxy?: string): T[] {
  const groups = new Map<string, T[]>()
  for (const profile of profiles) {
    const key = profileProxyKey(profile)
    const group = groups.get(key) ?? []
    group.push(profile)
    groups.set(key, group)
  }
  const ordered: T[] = []
  while (groups.size) {
    const candidates = [...groups].sort((a, b) => b[1].length - a[1].length)
    const [key, group] = candidates.find(([key]) => key !== previousProxy) ?? candidates[0]
    ordered.push(group.shift()!)
    if (!group.length) groups.delete(key)
    previousProxy = key
  }
  return ordered
}
