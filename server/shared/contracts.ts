/** Internal profile DTO. Field names and timestamps match Convex. */
export type ProfileRecord = {
  paused?: boolean
  pendingRenameFrom?: string
  id: string
  igAccountId?: string
  name: string
  igLoggedIn?: boolean
  outreachReady?: boolean
  unreadChatCount?: number
  unreadChatsCheckedAt?: number
  createdAt?: number
  proxy?: string
  proxyType?: string
  status?: string
  inUse: boolean
  fingerprintOs?: string
  fingerprintSeed?: number
  cookiesJson?: string
  instagramSessionId?: string
  modelId?: string
  lastOpenedAt?: number
}

export type SocketTopic = 'all' | 'displays'

export type WebSocketEventType =
  | 'automation_status'
  | 'error'
  | 'session_started'
  | 'profile_started'
  | 'session_decision'
  | 'profile_completed'
  | 'model_setup_after_session'
  | 'session_ended'
  | 'worker_waiting'
  | 'display_allocated'
  | 'display_released'

type EventFields = {
  displayId?: string
  decision?: import('./sessionDecision.js').SessionDecision | null
  dueAt?: number
  automationId?: string
  id?: string
  status?: string
  profileName?: string
  profileId?: string
  error?: string
  vncPort?: number
  displayNum?: number
  ts?: string | number
}

export type WorkerEvent = {
  [Kind in WebSocketEventType]: EventFields & { type: Kind }
}[WebSocketEventType]
