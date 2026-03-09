export type Profile = {
  id: string
  name: string
  proxy?: string
  proxy_type?: string
  fingerprint_seed?: string
  fingerprint_os?: string
  cookies_json?: string
  test_ip?: boolean
  status?: string
  using?: boolean
  login?: boolean
  daily_scraping_limit?: number | null
  daily_scraping_used?: number
}

export type ProfileMode =
  | 'list'
  | 'create'
  | 'edit'
  | 'delete'
  | 'logs'
  | 'login'


