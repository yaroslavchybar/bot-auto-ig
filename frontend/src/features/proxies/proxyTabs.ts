export const PROXY_TABS = [
  { id: 'proxies', label: 'Proxies' },
  { id: 'blacklist', label: 'Blacklist' },
] as const

export type ProxyTabId = (typeof PROXY_TABS)[number]['id']

export function parseProxyTab(value: string | null): ProxyTabId {
  return value === 'blacklist' ? 'blacklist' : 'proxies'
}
