import { StringDecoder } from 'node:string_decoder'
import { isLogEntry, type LogEntry } from '../shared/loggingTypes.js'

export interface ParsedLog {
  message: string
  level: 'info' | 'error'
  eventType?: string
  metadata?: Record<string, unknown>
  logEntry?: LogEntry
}

/** Logs and the worker control protocol share a pipe, but have separate consumers. */
export function parseLogLine(raw: string): ParsedLog | null {
  const line = raw.trim()
  if (!line) return null
  if (line.startsWith('__EVENT__') && line.endsWith('__EVENT__')) {
    try {
      const metadata = JSON.parse(line.slice(9, -9))
      if (metadata && typeof metadata === 'object' && !Array.isArray(metadata) && typeof metadata.type === 'string')
        return { message: metadata.type, level: metadata.type === 'error' ? 'error' : 'info', eventType: metadata.type, metadata }
    } catch { /* Malformed control messages remain diagnostic output. */ }
  }
  try {
    const entry: unknown = JSON.parse(line)
    if (isLogEntry(entry)) return { message: entry.message, level: entry.level, logEntry: entry }
  } catch { /* Libraries may write plain text. The parent wraps it as JSON. */ }
  return { message: line.slice(0, 4000), level: 'info' }
}

/** Buffer incomplete UTF-8 lines. Discard oversized lines without interpreting fragments as control messages. */
export function createLogStreamParser() {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  let discarding = false
  const limit = 256 * 1024
  const consume = (text: string, flush: boolean): ParsedLog[] => {
    const results: ParsedLog[] = []
    for (const part of text.split(/(?<=\n)/)) {
      const complete = part.endsWith('\n')
      if (!discarding) {
        pending += part
        if (pending.length > limit) {
          results.push({ message: 'Worker output line exceeded size limit', level: 'error' })
          pending = ''
          discarding = true
        } else if (complete) {
          const parsed = parseLogLine(pending)
          if (parsed) results.push(parsed)
          pending = ''
        }
      }
      if (complete) discarding = false
    }
    if (flush) {
      if (!discarding) {
        const parsed = parseLogLine(pending)
        if (parsed) results.push(parsed)
      }
      pending = ''
      discarding = false
    }
    return results
  }
  return {
    write: (chunk: Buffer) => consume(decoder.write(chunk), false),
    end: () => consume(decoder.end(), true),
  }
}

const BENIGN_BROWSER_STDERR = [
  /^CloakBrowser - stealth Chromium for automation$/,
  /^https:\/\/github\.com\/CloakHQ\/CloakBrowser$/,
  /^CloakBrowser (free|pro) \(v[^)]*\):/i,
  /^CloakBrowser Pro active \(v[^)]*\)/i,
  /^Pro support -> support@cloakbrowser\.dev$/,
  /^Running the free binary \(v[^)]*\)/i,
  /^Get your key: run\s+cloakbrowser login/i,
  /^\[cloakbrowser\] Preview channel requested, but no preview build is available/i,
  /^For more than one concurrent session/i,
  /^Star us if CloakBrowser helps your project!$/,
  /Incomplete Windows font set/i,
  /^\[cloakbrowser\] (Downloading GeoIP|GeoIP database ready)/i,
]

export function isBenignBrowserStderr(message: string): boolean {
  const line = String(message || '').trim()
  if (!line) return false
  return BENIGN_BROWSER_STDERR.some((pattern) => pattern.test(line))
}

export function parseLogOutput(raw: string): ParsedLog[] {
  return raw.split('\n').flatMap(line => { const parsed = parseLogLine(line); return parsed ? [parsed] : [] })
}
