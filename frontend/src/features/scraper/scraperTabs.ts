export const SCRAPER_TABS = [
  { id: 'jobs', label: 'Jobs' },
  { id: 'accounts', label: 'Scraping accounts' },
  { id: 'saved', label: 'Saved accounts' },
  { id: 'lists', label: 'Lists' },
] as const

export type ScraperTabId = (typeof SCRAPER_TABS)[number]['id']

export function parseScraperTab(value: string | null): ScraperTabId {
  return value === 'accounts' || value === 'saved' || value === 'lists' ? value : 'jobs'
}

export function scraperTabHref(tab: ScraperTabId) {
  return `/scraper?tab=${tab}`
}
