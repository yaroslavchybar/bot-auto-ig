import type { ChatMessage, ChatThread } from '../types'

// Backend returns microsecond timestamps divided by 1000 (ms epoch),
// but guard against second-epoch values so labels never show 1970.
export function normalizeTimestamp(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return value < 1e12 ? value * 1000 : value
}

export function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  try {
    const json = JSON.parse(raw) as { error?: { message?: string } }
    return json.error?.message || raw
  } catch {
    return raw
  }
}

// Non-text items (media, likes, reactions) carry no text — show a readable label.
export function messageText(message: ChatMessage): string {
  if (message.text) return message.text
  const kind = message.kind || 'message'
  return `[${kind}]`
}

export function attachmentLabel(kind: string): string | null {
  const normalized = kind.toLowerCase()
  if (!normalized || normalized === 'text') return null
  const labels: Record<string, string> = {
    media: 'Photo',
    image: 'Photo',
    video: 'Video',
    voice_media: 'Voice message',
    audio: 'Voice message',
    like: 'Like',
    reaction: 'Reaction',
    reel_share: 'Reel',
    clip: 'Clip',
    story_share: 'Story',
    link: 'Link',
    location: 'Location',
    profile: 'Profile',
    placeholder: 'Attachment',
  }
  return labels[normalized] ?? kind.replace(/_/g, ' ')
}

export function threadPreview(thread: ChatThread): string {
  const latest = thread.messages[0]
  return latest ? messageText(latest) : 'No preview'
}

export function threadTime(thread: ChatThread): number {
  return normalizeTimestamp(thread.messages[0]?.timestamp ?? 0)
}

export function sortThreadsByLatest(threads: ChatThread[]): ChatThread[] {
  return [...threads].sort((a, b) => threadTime(b) - threadTime(a))
}

export function filterThreads(
  threads: ChatThread[],
  query: string,
): ChatThread[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return threads
  return threads.filter((thread) => {
    const haystacks = [
      thread.title,
      thread.profileName ?? '',
      ...thread.users.map((user) => user.username),
      thread.messages[0] ? messageText(thread.messages[0]) : '',
    ]
    return haystacks.some((value) => value.toLowerCase().includes(needle))
  })
}

export function initials(name: string): string {
  const cleaned = name.replace(/^[^\p{L}\p{N}]+/u, '').trim()
  if (!cleaned) return '?'
  const parts = cleaned.split(/[\s._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return cleaned.slice(0, 2).toUpperCase()
}

export function formatClock(timestamp: number): string {
  const time = normalizeTimestamp(timestamp)
  if (!time) return ''
  return new Date(time).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatTimeAgo(timestamp: number, now: number): string {
  const time = normalizeTimestamp(timestamp)
  if (!time) return ''
  const diff = Math.max(0, now - time)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return 'Just now'
  if (diff < hour) {
    const minutes = Math.floor(diff / minute)
    return `${minutes}m ago`
  }
  if (diff < day) {
    const hours = Math.floor(diff / hour)
    return `${hours}h ago`
  }
  if (diff < 7 * day) {
    const days = Math.floor(diff / day)
    return `${days}d ago`
  }
  return new Date(time).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })
}

export function formatDayLabel(timestamp: number): string {
  const time = normalizeTimestamp(timestamp)
  const date = new Date(time)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// Oldest-first order for rendering; groups consecutive same-sender messages.
export type MessageGroup = {
  senderId: string
  messages: ChatMessage[]
  dayChanged: boolean
}

export function groupMessages(messages: ChatMessage[]): MessageGroup[] {
  const ordered = [...messages].reverse()
  const groups: MessageGroup[] = []
  let lastDay = ''
  for (const message of ordered) {
    const day = formatDayLabel(message.timestamp)
    const dayChanged = day !== lastDay
    lastDay = day
    const current = groups[groups.length - 1]
    const gap =
      current && message.timestamp && current.messages.length
        ? normalizeTimestamp(message.timestamp) -
          normalizeTimestamp(
            current.messages[current.messages.length - 1].timestamp,
          )
        : Number.POSITIVE_INFINITY
    if (
      current &&
      !dayChanged &&
      current.senderId === message.senderId &&
      gap < 5 * 60_000
    ) {
      current.messages.push(message)
    } else {
      groups.push({
        senderId: message.senderId,
        messages: [message],
        dayChanged,
      })
    }
  }
  return groups
}
