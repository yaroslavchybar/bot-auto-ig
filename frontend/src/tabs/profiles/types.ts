export type Profile = {
  id: string
  name: string
  proxy?: string
  proxy_type?: string
  fingerprint_seed?: string
  fingerprint_os?: string
  automation?: boolean
  test_ip?: boolean
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
