export type ProxyItem = {
  id: string
  name: string
  proxy: string
  proxyType: string
  purpose: 'work' | 'login'
  country?: string
  maxProfiles: number
  loginCooldownUntil?: number
}

export type ProxyFormValues = {
  name: string
  proxy: string
  proxyType: string
  purpose: 'work' | 'login'
  country?: string
  maxProfiles: number
}
