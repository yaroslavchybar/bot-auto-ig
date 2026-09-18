export type LogEntry = {
  id?: string
  message: string
  level: string
  source: string
  profileName?: string
  automationId?: string
  taskId?: string
  targetUsername?: string
  errorCode?: string
  outcome?: string
  attempt?: number
  diagnostics?: string
  ts: number
}


/** Merge overlapping history and live events without losing entries at capacity. */
export function mergeLogs(current: LogEntry[], incoming: LogEntry[], capacity: number): LogEntry[] {
  const byId = new Map<string, LogEntry>()
  for (const entry of [...current, ...incoming]) {
    const key = entry.id
      ? `id:${entry.id}`
      : `fallback:${JSON.stringify([
          entry.ts,
          entry.message,
          entry.level,
          entry.source,
          entry.automationId,
          entry.profileName,
          entry.taskId,
          entry.targetUsername,
          entry.errorCode,
          entry.outcome,
          entry.attempt,
          entry.diagnostics,
        ])}`
    byId.set(key, entry)
  }
  return [...byId.values()].sort((a, b) => a.ts - b.ts).slice(-Math.max(1, capacity))
}
