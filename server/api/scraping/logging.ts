import { broadcast } from '../../websocket.js'

export type ScrapeLogKind = 'followers' | 'following'
export type ScrapeLogLevel = 'info' | 'warn' | 'error' | 'success' | 'debug'

interface ScraperLogOptions {
  level?: ScrapeLogLevel
  profileName?: string
}

export function formatScrapeLabel(kind: ScrapeLogKind): string {
  return kind === 'followers' ? 'followers' : 'following'
}

export function formatTarget(targetUsername: string): string {
  const cleaned = String(targetUsername || '').trim().replace(/^@+/, '')
  return cleaned ? `@${cleaned}` : '@unknown'
}

export function emitScraperLog(message: string, options: ScraperLogOptions = {}) {
  broadcast({
    type: 'log',
    message,
    level: options.level || 'info',
    source: 'scraper',
    ...(options.profileName ? { profileName: options.profileName } : {}),
  })
}
