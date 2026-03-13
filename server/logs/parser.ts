/**
 * Log Parser - Parse and format Python automation log output.
 * Handles structured events, debug messages, and plain log lines.
 */

interface ParsedLog {
    message: string
    level: 'info' | 'warn' | 'error' | 'success' | 'debug'
    source: 'python' | 'server'
    eventType?: string
    metadata?: Record<string, unknown>
    explicitLevel?: boolean
}

const EVENT_PREFIX = '__EVENT__'

// Timestamp pattern at start of lines: [2026-01-08T09:47:29+00:00]
const TIMESTAMP_PATTERN = /^\[?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\]]*\]?\s*/

// Debug prefix pattern
const DEBUG_PATTERN = /^DEBUG:\s*/i
const STREAM_PREFIX_PATTERN = /^-\s*\[pid=\d+\]\[(out|err)\]\s*/i
const EXPLICIT_LEVEL_PATTERN = /^(INFO|WARNING|WARN|ERROR|CRITICAL|SUCCESS)\s*:\s*/i

/**
 * Human-readable event type mapping
 */
const EVENT_LABELS: Record<string, string> = {
    session_started: '🚀 Session started',
    session_ended: '🏁 Session ended',
    profile_started: '👤 Profile started',
    profile_completed: '✅ Profile completed',
    profile_skipped: '⏭️ Profile skipped',
    task_started: '📋 Task started',
    task_completed: '✓ Task completed',
    task_progress: '↻ Task progress',
    action_performed: '⚡ Action performed',
    error: '❌ Error',
}

function parseStructuredEvent(line: string): Record<string, unknown> | null {
    if (!line.startsWith(EVENT_PREFIX)) return null

    const payload = line.endsWith(EVENT_PREFIX)
        ? line.slice(EVENT_PREFIX.length, -EVENT_PREFIX.length)
        : line.slice(EVENT_PREFIX.length)

    try {
        return JSON.parse(payload)
    } catch {
        return null
    }
}

/**
 * Parse a single log line from Python output.
 */
export function parseLogLine(raw: string): ParsedLog | null {
    const line = raw.trim()
    if (!line) return null

    const eventData = parseStructuredEvent(line)
    if (eventData) {
        const eventType = String(eventData.type || 'unknown')
        const label = EVENT_LABELS[eventType] || eventType

        // Build human-readable message
        let message = label
        if (eventData.profile) message += `: ${eventData.profile}`
        if (eventData.task) message += ` - ${eventData.task}`
        if (eventData.total_accounts) message += ` (${eventData.total_accounts} accounts)`

        return {
            message,
            level: eventType === 'error' ? 'error' : 'info',
            source: 'python',
            eventType,
            metadata: eventData,
        }
    }

    // Remove timestamps from messages (frontend adds its own)
    let cleaned = line.replace(TIMESTAMP_PATTERN, '')
    cleaned = cleaned.replace(STREAM_PREFIX_PATTERN, '')

    // Check for DEBUG messages - filter or demote
    if (DEBUG_PATTERN.test(cleaned)) {
        // Skip debug messages entirely for cleaner output
        return null
    }

    // Determine level from content
    let level: ParsedLog['level'] = 'info'
    let explicitLevel = false

    const explicitMatch = cleaned.match(EXPLICIT_LEVEL_PATTERN)
    if (explicitMatch) {
        explicitLevel = true
        const token = String(explicitMatch[1] || '').toLowerCase()
        if (token === 'warning' || token === 'warn') {
            level = 'warn'
        } else if (token === 'error' || token === 'critical') {
            level = 'error'
        } else if (token === 'success') {
            level = 'success'
        } else {
            level = 'info'
        }
        cleaned = cleaned.replace(EXPLICIT_LEVEL_PATTERN, '')
    }

    if (cleaned.startsWith('[!]')) {
        level = 'warn'
        explicitLevel = true
        cleaned = cleaned.replace(/^\[!\]\s*/, '')
    } else if (cleaned.startsWith('[*]')) {
        level = 'info'
        explicitLevel = true
        cleaned = cleaned.replace(/^\[\*\]\s*/, '')
    } else if (cleaned.startsWith('[✓]') || cleaned.includes('successfully') || cleaned.includes('finished')) {
        level = 'success'
        cleaned = cleaned.replace(/^\[✓\]\s*/, '')
    } else if (/\b(error|failed|exception)\b/i.test(cleaned)) {
        level = 'error'
    }

    // Skip empty or very short messages
    if (cleaned.length < 3) return null

    return {
        message: cleaned,
        level,
        source: 'python',
        explicitLevel,
    }
}

/**
 * Parse multiple log lines (handles multi-line output from Python).
 */
export function parseLogOutput(raw: string): ParsedLog[] {
    const lines = raw.split('\n')
    const results: ParsedLog[] = []

    for (const line of lines) {
        const parsed = parseLogLine(line)
        if (parsed) {
            results.push(parsed)
        }
    }

    return results
}
