export type LogEntry = {
  message: string
  level: string
  source: string
  profileName?: string
  workflowId?: string
  taskId?: string
  targetUsername?: string
  errorCode?: string
  outcome?: string
  attempt?: number
  diagnostics?: string
  ts: number
}

