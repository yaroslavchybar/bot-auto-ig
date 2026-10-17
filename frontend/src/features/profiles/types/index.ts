export type Profile = {
  paused?: boolean
  igLoggedIn?: boolean
  outreachReady?: boolean
  unreadChatCount?: number
  unreadChatsCheckedAt?: number
  pendingRenameFrom?: string
  id: string
  name: string
  proxy?: string
  proxyType?: string
  fingerprintOs?: string
  cookiesJson?: string
  status?: string
  inUse?: boolean
}
