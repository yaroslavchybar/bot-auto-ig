import { parseLogLine } from '../logs/parser.js'

const NON_EVENT_TYPES = new Set(['status', 'log', 'workflow_status'])

function extractDirectEvent(msg: Record<string, unknown>): Record<string, unknown> | null {
    const type = typeof msg.type === 'string' ? msg.type : ''
    if (!type || NON_EVENT_TYPES.has(type)) return null

    const event: Record<string, unknown> = { type }
    for (const [key, value] of Object.entries(msg)) {
        if (key === 'message' || key === 'level' || key === 'source' || key === 'status') {
            continue
        }
        event[key] = value
    }

    return event
}

function extractEventFromLogMessage(msg: Record<string, unknown>): Record<string, unknown> | null {
    const message = typeof msg.message === 'string' ? msg.message.trim() : ''
    if (!message.startsWith('__EVENT__')) return null

    const parsed = parseLogLine(message)
    if (!parsed?.eventType || !parsed.metadata) return null

    return parsed.metadata
}

export function extractAutomationEvent(message: unknown): Record<string, unknown> | null {
    if (!message || typeof message !== 'object') return null

    const record = message as Record<string, unknown>
    return extractDirectEvent(record) ?? extractEventFromLogMessage(record)
}
