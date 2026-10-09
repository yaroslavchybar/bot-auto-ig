export const SCRAPER_TABS = [
  { id: 'sources', label: 'Sources' },
  { id: 'accounts', label: 'Scrapers' },
  { id: 'saved', label: 'Leads' },
] as const

export type ScraperTabId = (typeof SCRAPER_TABS)[number]['id']

export function parseScraperTab(value: string | null): ScraperTabId {
  return value === 'accounts' || value === 'saved' ? value : 'sources'
}

export function scraperTabHref(tab: ScraperTabId) {
  return `/scraper?tab=${tab}`
}
