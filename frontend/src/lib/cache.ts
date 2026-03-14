const CACHE_VERSION = 1
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface CacheEntry<T> {
  version: number
  timestamp: number
  data: T
}

export function getCache<T>(key: string): T | null {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return null
  }

  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const entry: CacheEntry<T> = JSON.parse(raw)
    if (entry.version !== CACHE_VERSION) return null
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) return null
    return entry.data
  } catch {
    return null
  }
}

export function setCache<T>(key: string, data: T): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return
  }

  const entry: CacheEntry<T> = {
    version: CACHE_VERSION,
    timestamp: Date.now(),
    data,
  }
  localStorage.setItem(key, JSON.stringify(entry))
}
