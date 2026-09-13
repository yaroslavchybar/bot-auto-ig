import type { Profile } from '../types'
import type { Doc } from '../../../../../convex/_generated/dataModel'

/** UI projection deliberately excludes session cookies. */
export function mapProfileRecord(record: Doc<'profiles'>): Profile {
  return {
    id: record._id, name: record.name, proxy: record.proxy,
    proxyType: record.proxyType, fingerprintOs: record.fingerprintOs,
    testIp: record.testIp, status: record.status, using: record.using, login: record.login,
    dailyScrapingLimit: record.dailyScrapingLimit,
    assignedAccountsLimit: record.assignedAccountsLimit,
    dailyScrapingUsed: record.dailyScrapingUsed,
  }
}
