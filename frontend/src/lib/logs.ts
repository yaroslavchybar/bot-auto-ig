export type LogEntry = {
  message: string
  level: string
  source: string
  profileName?: string
  workflowId?: string
  ts: number
}

