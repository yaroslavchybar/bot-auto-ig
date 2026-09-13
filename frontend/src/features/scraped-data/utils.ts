import type { ScrapeJob, ScrapedAccount } from './types'

export function formatDateTime(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  return new Date(value).toLocaleString()
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value)
}

// Rows = accounts actually added to the table. `deduped` only counts
// filtered-out and already-known users, so it must not win here.
export function getJobRowCount(job: ScrapeJob) {
  const scraped = Number(job.stats?.scraped ?? NaN)
  if (Number.isFinite(scraped)) return Math.max(0, scraped)
  return 0
}

function sortTimestamp(value: unknown) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

export function getJobSortTimestamp(job: ScrapeJob) {
  return Math.max(sortTimestamp(job.updatedAt), sortTimestamp(job.createdAt))
}

export function getResultSortTimestamp(result: ScrapedAccount) {
  return sortTimestamp(result.createdAt)
}

export function jobMatchesQuery(job: ScrapeJob, query: string) {
  if (!query) return true
  const haystack = [job.name, job.status, job.error, ...job.targets]
    .map((value) => String(value || '').toLowerCase())
    .join(' ')
  return haystack.includes(query)
}

export function resultMatchesQuery(result: ScrapedAccount, query: string, jobName: string) {
  if (!query) return true
  const haystack = [result.userName, result.fullName, jobName, result.status]
    .map((value) => String(value || '').toLowerCase())
    .join(' ')
  return haystack.includes(query)
}
