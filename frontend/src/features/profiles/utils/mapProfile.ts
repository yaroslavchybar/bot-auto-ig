import type { Profile } from '../types'

type ProfileRecord = Record<string, unknown> & {
  _id?: unknown
  name?: unknown
  proxy?: unknown
  proxyType?: unknown
  fingerprintSeed?: unknown
  fingerprintOs?: unknown
  cookiesJson?: unknown
  testIp?: unknown
  status?: unknown
  using?: unknown
  login?: unknown
  dailyScrapingLimit?: unknown
  dailyScrapingUsed?: unknown
}

export function mapProfileRecord(record: ProfileRecord | null | undefined): Profile {
  return {
    id: String(record?._id ?? ''),
    name: String(record?.name ?? ''),
    proxy: typeof record?.proxy === 'string' ? record.proxy : undefined,
    proxy_type:
      typeof record?.proxyType === 'string' ? record.proxyType : undefined,
    fingerprint_seed:
      typeof record?.fingerprintSeed === 'string'
        ? record.fingerprintSeed
        : undefined,
    fingerprint_os:
      typeof record?.fingerprintOs === 'string' ? record.fingerprintOs : undefined,
    cookies_json:
      typeof record?.cookiesJson === 'string' ? record.cookiesJson : undefined,
    test_ip: Boolean(record?.testIp),
    status: typeof record?.status === 'string' ? record.status : undefined,
    using: Boolean(record?.using),
    login: Boolean(record?.login),
    daily_scraping_limit:
      typeof record?.dailyScrapingLimit === 'number'
        ? record.dailyScrapingLimit
        : null,
    daily_scraping_used:
      typeof record?.dailyScrapingUsed === 'number' ? record.dailyScrapingUsed : 0,
  }
}
