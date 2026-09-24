/** Internal profile DTO. Field names and timestamps match Convex. */
export type ProfileRecord = {
  renameFrom?: string
  id: string
  name: string
  igLoggedIn?: boolean
  outreachReady?: boolean
  createdAt?: number
  proxy?: string
  proxyType?: string
  status?: string
  mode?: string
  using: boolean
  fingerprintOs?: string
  cookiesJson?: string
  sessionId?: string
  scraperDailyLimit?: number
  scraperUsageDate?: string
  scraperUsageCount?: number
  listIds?: string[]
  lastOpenedAt?: number
}

export const ACTIVITY_IDS = ['browse_feed', 'close_browser', 'condition', 'delay', 'loop', 'random_branch', 'watch_stories'] as const
export type ActivityId = typeof ACTIVITY_IDS[number]

export type SocketTopic = 'all' | 'displays' | 'logs'

export type WebSocketEventType =
  | 'log'
  | 'status'
  | 'automation_status'
  | 'error'
  | 'session_started'
  | 'profile_started'
  | 'task_started'
  | 'task_progress'
  | 'task_completed'
  | 'checkpoint'
  | 'profile_completed'
  | 'session_ended'
  | 'display_allocated'
  | 'display_released'

type EventFields = {
  automationId?: string
  id?: string
  message?: string
  level?: string
  source?: string
  status?: string
  totalAccounts?: number
  totalProfiles?: number
  profileName?: string
  profileId?: string
  taskId?: string
  task?: string
  nodeId?: string
  nodeStates?: Record<string, unknown>
  targetUsername?: string
  error?: string
  errorCode?: string
  outcome?: string
  attempt?: number
  diagnostics?: string
  vncPort?: number
  displayNum?: number
  ts?: string | number
}

export type WorkerEvent = { [Kind in WebSocketEventType]: EventFields & { type: Kind } }[WebSocketEventType]
