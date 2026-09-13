export type Profile = {
  id: string
  name: string
  proxy?: string
  proxyType?: string
  fingerprintOs?: string
  cookiesJson?: string
  testIp?: boolean
  status?: string
  using?: boolean
  login?: boolean
  dailyScrapingLimit?: number | null
  assignedAccountsLimit?: number | null
  dailyScrapingUsed?: number
}
