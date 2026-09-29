import '../env.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import pino from 'pino'
import { sanitizeLogValue } from './loggingSanitize.js'
import type { LogEntry, LogError, LogFields, LogLevel, LogOutcome } from './loggingTypes.js'

export type { LogEntry, LogFields, LogLevel } from './loggingTypes.js'
export { sanitizeLogValue } from './loggingSanitize.js'

const source = process.env.LOG_SERVICE || 'api'
const environment = {
  service: source,
  version: process.env.SERVICE_VERSION || '1.0.0',
  commitHash: process.env.COMMIT_SHA || process.env.GIT_COMMIT || 'unknown',
  region: process.env.REGION || (process.env.NODE_ENV === 'production' ? 'unknown' : 'local'),
  instanceId: process.env.INSTANCE_ID || hostname(),
  runtime: `bun:${process.versions.bun || process.version}`,
  nodeEnv: process.env.NODE_ENV || 'development',
}
const secrets = Object.entries(process.env)
  .filter(([key, value]) => /password|secret|token|api.?key|private.?key/i.test(key) && value)
  .map(([, value]) => value!)
const output = pino({ level: 'info', base: undefined, timestamp: false,
  formatters: { level: label => ({ level: label }) } })

export class LogScope {
  readonly operationId = randomUUID()
  readonly startedAt = performance.now()
  readonly requestId: string
  readonly parentOperationId?: string
  readonly fields: Record<string, unknown>
  private notes: Record<string, unknown>[] = []
  private noteCount = 0
  private stepCounts: Record<string, number> = {}
  private hasErrors = false
  private lastError: unknown
  private redactions: string[] = []
  completed = false

  constructor(readonly event: string, fields: Record<string, unknown>, parent = scopes.getStore()) {
    // Timers/subscriptions can outlive the request or startup that registered them.
    if (parent?.completed) parent = undefined
    this.redactions = [...(parent?.redactions || [])]
    this.requestId = String(fields.requestId || parent?.requestId || process.env.LOG_REQUEST_ID || randomUUID())
    this.parentOperationId = parent?.operationId
    this.fields = { profileId: parent?.fields.profileId, profileName: parent?.fields.profileName,
      automationId: parent?.fields.automationId || process.env.LOG_AUTOMATION_ID, ...fields }
  }

  add(fields: Record<string, unknown>): void { Object.assign(this.fields, fields) }

  /** Register account credentials before using libraries that may quote arguments in errors. */
  redact(values: string[]): void {
    this.redactions = [...new Set([...this.redactions, ...values.filter(value => value.length >= 4)])].slice(-20)
  }

  safeFields(fields: Record<string, unknown>): Record<string, unknown> {
    return sanitizeLogValue(fields, [...secrets, ...this.redactions]) as Record<string, unknown>
  }

  note(level: LogLevel, fields: LogFields): void {
    this.noteCount++
    if (Object.keys(this.stepCounts).length < 100 || fields.event in this.stepCounts)
      this.stepCounts[fields.event] = (this.stepCounts[fields.event] || 0) + 1
    const note = this.safeFields({ level, ...fields })
    if (level === 'error') {
      this.hasErrors = true
      if (note.error) this.lastError = note.error
    }
    this.notes.push(note)
    if (this.notes.length > 20) this.notes.shift()
  }

  finish(outcome: LogOutcome = 'success'): void {
    if (this.completed) return
    this.completed = true
    const requestedOutcome = this.fields.outcome || outcome
    const finalOutcome = this.hasErrors && requestedOutcome === 'success' ? 'error' : requestedOutcome
    emit(this.hasErrors || finalOutcome === 'error' ? 'error' : 'info', this.safeFields({
      ...this.fields, error: this.fields.error ?? this.lastError, event: this.event, requestId: this.requestId,
      operationId: this.operationId, parentOperationId: this.parentOperationId,
      outcome: finalOutcome, durationMs: Math.round(performance.now() - this.startedAt),
      ...(this.noteCount ? { notes: this.notes, noteCount: this.noteCount, stepCounts: this.stepCounts } : {}),
    }) as LogFields)
  }
}

const scopes = new AsyncLocalStorage<LogScope>()
export const currentLogScope = () => scopes.getStore()
export const currentRequestId = () => {
  const scope = scopes.getStore()
  return (!scope?.completed ? scope?.requestId : undefined) || process.env.LOG_REQUEST_ID
}
export const runInLogScope = <T>(scope: LogScope, action: () => T): T => scopes.run(scope, action)
export function addLogContext(fields: Record<string, unknown>): void {
  const scope = scopes.getStore()
  if (scope && !scope.completed) scope.add(fields)
}
export function redactLogValues(...values: string[]): void { scopes.getStore()?.redact(values) }

/** Emit once when a request/job finishes; nested operations keep the same request ID. */
export async function logOperation<T>(event: string, fields: Record<string, unknown>, action: (scope: LogScope) => Promise<T>): Promise<T> {
  const scope = new LogScope(event, fields)
  return runInLogScope(scope, async () => {
    try { return await action(scope) }
    catch (error) {
      scope.add({ error, outcome: scope.fields.outcome === 'cancelled' ? 'cancelled' : 'error' })
      throw error
    } finally { scope.finish() }
  })
}

const STANDARD_FIELDS = new Set(['event', 'message', 'source', 'requestId', 'operationId', 'parentOperationId',
  'outcome', 'durationMs', 'profileId', 'profileName', 'automationId', 'jobId', 'taskId', 'nodeId', 'targetUsername', 'error'])

function emit(level: LogLevel, fields: LogFields): void {
  const clean = sanitizeLogValue(fields, secrets) as LogFields
  const { event, message, ...rest } = clean
  const context = Object.fromEntries(Object.entries(rest).filter(([key]) => !STANDARD_FIELDS.has(key)))
  const entry = {
    ...Object.fromEntries(Object.entries(rest).filter(([key]) => STANDARD_FIELDS.has(key))),
    id: randomUUID(), ts: Date.now(), event, message: message || event.replace(/[._]/g, ' '), level,
    source: typeof clean.source === 'string' ? clean.source : source,
    requestId: typeof clean.requestId === 'string' ? clean.requestId : currentRequestId() || randomUUID(),
    outcome: (clean.outcome || (level === 'error' ? 'error' : 'success')) as LogOutcome,
    error: typeof clean.error === 'string' ? { type: 'Error', message: clean.error } : clean.error as LogError | undefined,
    environment, context,
  } as LogEntry
  write(entry)
}

function write(entry: LogEntry): void {
  const { level, ...fields } = entry
  output[level](fields)
}

function record(level: LogLevel, fields: LogFields): void {
  const scope = scopes.getStore()
  if (scope && !scope.completed) scope.note(level, fields)
  else emit(level, (scope ? scope.safeFields(fields) : fields) as LogFields)
}

/** Relay a child's completed event without rewriting its identity or timestamp. */
export function ingestLogEntry(entry: LogEntry): void {
  const clean = sanitizeLogValue(entry, secrets) as LogEntry
  write(clean)
}

export default {
  info: (fields: LogFields) => record('info', fields),
  error: (fields: LogFields) => record('error', fields),
}
