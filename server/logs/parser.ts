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
}

// Event pattern: __EVENT__{"type": "...", ...}__EVENT__
const EVENT_PATTERN = /__EVENT__(\{.*?\})__EVENT__/

// Timestamp pattern at start of lines: [2026-01-08T09:47:29+00:00]
const TIMESTAMP_PATTERN = /^\[?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\]]*\]?\s*/

// Debug prefix pattern
const DEBUG_PATTERN = /^DEBUG:\s*/i

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
    action_performed: '⚡ Action performed',
    error: '❌ Error',
}

/**
 * Parse a single log line from Python output.
 */
export function parseLogLine(raw: string): ParsedLog | null {
    const line = raw.trim()
    if (!line) return null

    // Check for structured event
    const eventMatch = line.match(EVENT_PATTERN)
    if (eventMatch) {
        try {
            const eventData = JSON.parse(eventMatch[1])
            const eventType = eventData.type || 'unknown'
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
        } catch {
            // Failed to parse JSON, treat as plain message
        }
    }

    // Remove timestamps from messages (frontend adds its own)
    let cleaned = line.replace(TIMESTAMP_PATTERN, '')

    // Check for DEBUG messages - filter or demote
    if (DEBUG_PATTERN.test(cleaned)) {
        // Skip debug messages entirely for cleaner output
        return null
    }

    // Determine level from content
    let level: ParsedLog['level'] = 'info'

    if (cleaned.startsWith('[!]')) {
        level = 'warn'
        cleaned = cleaned.replace(/^\[!\]\s*/, '')
    } else if (cleaned.startsWith('[*]')) {
        level = 'info'
        cleaned = cleaned.replace(/^\[\*\]\s*/, '')
    } else if (cleaned.startsWith('[✓]') || cleaned.includes('successfully') || cleaned.includes('finished')) {
        level = 'success'
        cleaned = cleaned.replace(/^\[✓\]\s*/, '')
    } else if (cleaned.toLowerCase().includes('error') || cleaned.toLowerCase().includes('failed')) {
        level = 'error'
    }

    // Skip empty or very short messages
    if (cleaned.length < 3) return null

    return {
        message: cleaned,
        level,
        source: 'python',
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
