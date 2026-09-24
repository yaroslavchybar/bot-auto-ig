export type ChatMessage = {
  id: string
  senderId: string
  text: string
  timestamp: number
  kind: string
  clientContext?: string
  mediaType?: 'photo' | 'video' | 'voice'
  mediaUrl?: string
  reactions?: { senderId: string; emoji: string }[]
  delivery?: 'sending' | 'sent' | 'unconfirmed'
}

export type ChatThread = {
  id: string
  unread?: boolean
  profileId?: string
  profileName?: string
  viewerId?: string
  title: string
  users: { id: string; username: string }[]
  messages: ChatMessage[]
  lastSeenAt: { userId: string; timestamp: number }[]
}

export type AllChatInbox = {
  threads: ChatThread[]
  errors: { profileName: string; message: string }[]
}

export type ChatInbox = {
  viewerId: string
  threads: ChatThread[]
}

export type ChatSession = {
  connected: boolean
}
