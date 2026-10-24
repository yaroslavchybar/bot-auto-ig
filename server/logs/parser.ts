import { isLogEntry, type LogEntry } from '../shared/loggingTypes.js'

/** Logs and the worker control protocol share a pipe, but have separate consumers. */
export function parseLogLine(raw: string): LogEntry | null {
  const line = raw.trim()
  if (!line) return null
  try {
    const entry: unknown = JSON.parse(line)
    if (isLogEntry(entry)) return entry
  } catch { /* Libraries may write plain text. The parent wraps it as JSON. */ }
  return null
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
