export type LogLevel = 'info' | 'error'
export type LogOutcome = 'success' | 'error' | 'cancelled' | 'paused' | 'skipped' | 'rejected'
export type LogFields = { event: string; message?: string; [key: string]: unknown }
export type LogError = { type: string; message: string; code?: string; stack?: string }

/** Canonical JSON format shared by the server, worker pipes, and Convex bridge. */
export interface LogEntry {
  id: string
  ts: number
  event: string
  message: string
  level: LogLevel
  source: string
  requestId: string
  operationId?: string
  parentOperationId?: string
  outcome: LogOutcome
  durationMs?: number
  profileId?: string
  profileName?: string
  automationId?: string
  jobId?: string
  taskId?: string
  nodeId?: string
  targetUsername?: string
  error?: LogError
  environment: Record<string, string>
  context: Record<string, unknown>
}

export const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/

export function isLogEntry(value: unknown): value is LogEntry {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'string' && typeof v.ts === 'number' && Number.isFinite(v.ts) &&
    typeof v.event === 'string' && typeof v.message === 'string' &&
    (v.level === 'info' || v.level === 'error') && typeof v.source === 'string' &&
    typeof v.requestId === 'string' && REQUEST_ID_PATTERN.test(v.requestId) &&
    ['success', 'error', 'cancelled', 'paused', 'skipped', 'rejected'].includes(String(v.outcome)) &&
    !!v.context && typeof v.context === 'object' && !Array.isArray(v.context) &&
    !!v.environment && typeof v.environment === 'object' && !Array.isArray(v.environment)
}
