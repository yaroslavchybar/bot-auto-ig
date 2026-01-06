export type Profile = {
  id: string
  name: string
  proxy?: string
  proxy_type?: string
  type?: string
  user_agent?: string
  test_ip?: boolean
  ua_os?: string
  ua_browser?: string
  status?: string
  using?: boolean
  login?: boolean
}

export type LogEntry = {
  message: string
  level: string
  source: string
  ts: number
}

export type ProfileMode = 'list' | 'create' | 'edit' | 'delete' | 'logs' | 'login'
