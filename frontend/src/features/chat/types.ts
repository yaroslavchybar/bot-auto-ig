export type ChatArchiveRecord = { profileId: string; threadId: string }
export type ChatFolder = 'inbox' | 'archived'

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
  archived?: boolean
  unread?: boolean
  confirmedMessageIds?: string[]
  profileId?: string
  profileName?: string
  viewerId?: string
  title: string
  users: { id: string; username: string; profilePicUrl?: string }[]
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

export type OlderChatPage = {
  messages: ChatMessage[]
  nextCursor: string
  hasOlder: boolean
}
