import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Heart,
  Image as ImageIcon,
  Link2,
  MapPin,
  MessageSquare,
  Mic,
  Paperclip,
  Send,
  Video,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { ChatMessage, ChatThread } from '../types'
import {
  attachmentLabel,
  formatClock,
  formatDayLabel,
  groupMessages,
  initials,
  messageText,
} from '../utils/chat'

type ConversationViewProps = {
  conversation: ChatThread | null
  selectedThread: ChatThread | undefined
  selectedThreadId: string
  viewerId: string
  loading: boolean
  connected: boolean
  draft: string
  onDraftChange: (value: string) => void
  sending: boolean
  onSend: (event: FormEvent) => void
  replyMaxLength: number
  onBack: () => void
}

export function ConversationView({
  conversation,
  selectedThread,
  selectedThreadId,
  viewerId,
  loading,
  connected,
  draft,
  onDraftChange,
  sending,
  onSend,
  replyMaxLength,
  onBack,
}: ConversationViewProps) {
  const title = selectedThread?.title || conversation?.title || ''
  const users = selectedThread?.users.length ? selectedThread.users : conversation?.users ?? []
  const otherUsers = users.filter((user) => user.id !== viewerId)
  const instagramUsername =
    otherUsers.length === 1 && /^[a-zA-Z0-9._]{1,30}$/.test(otherUsers[0].username)
      ? otherUsers[0].username
      : ''
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const [stickToBottom, setStickToBottom] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const threadKey = conversation?.id ?? selectedThreadId
  const messageCount = conversation?.messages.length ?? 0

  // Jump to latest when a thread loads or new messages arrive (unless scrolled up).
  useEffect(() => {
    setStickToBottom(true)
  }, [threadKey])

  useEffect(() => {
    if (stickToBottom)
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messageCount, threadKey, stickToBottom])

  // Auto-grow composer up to ~160px.
  useEffect(() => {
    const field = composerRef.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${Math.min(field.scrollHeight, 160)}px`
  }, [draft])

  function handleScroll() {
    const node = scrollRef.current
    if (!node) return
    setStickToBottom(
      node.scrollHeight - node.scrollTop - node.clientHeight < 80,
    )
  }

  async function copyMessage(message: ChatMessage) {
    try {
      await navigator.clipboard.writeText(messageText(message))
      setCopiedId(message.id)
      setTimeout(
        () =>
          setCopiedId((current) => (current === message.id ? null : current)),
        1500,
      )
    } catch {
      // Clipboard unavailable — no-op, text remains selectable.
    }
  }

  function sendOnEnter(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault()
      if (draft.trim() && !sending) onSend(event as unknown as FormEvent)
    }
  }

  if (!selectedThreadId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <MessageSquare className="text-subtle-copy size-8" />
        <p className="text-sm font-medium">Select a conversation</p>
        <p className="text-muted-copy max-w-xs text-xs">
          Choose a thread from the list to read messages and send text replies.
        </p>
      </div>
    )
  }

  const groups = conversation ? groupMessages(conversation.messages) : []
  const seenAt = conversation?.lastSeenAt ?? selectedThread?.lastSeenAt ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-line-soft flex items-center gap-2.5 border-b px-3 py-2 md:px-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label="Back to conversations"
          className="md:hidden"
        >
          <ArrowLeft />
        </Button>
        <Avatar className="brand-avatar size-8 shrink-0 border">
          <AvatarFallback className="bg-panel-strong text-copy text-[11px] font-semibold">
            {initials(title)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">
            {title || 'Conversation'}
          </p>
          <ConversationSubtitle
            users={users}
            profileName={selectedThread?.profileName}
          />
        </div>
        {instagramUsername && (
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <a
              href={`https://www.instagram.com/${instagramUsername}/`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open @${instagramUsername} on Instagram`}
            >
              <ExternalLink />
              <span className="hidden sm:inline">Open profile</span>
            </a>
          </Button>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-4 py-4 md:px-6"
        >
          {loading && !conversation && <MessageSkeletons />}
          {!loading && conversation && groups.length === 0 && (
            <div className="text-muted-copy flex h-full items-center justify-center text-sm">
              No messages in this thread yet.
            </div>
          )}
          {groups.map((group, groupIndex) => (
            <div key={`${group.messages[0]?.id ?? groupIndex}`}>
              {group.dayChanged && (
                <div className="my-3 flex justify-center">
                  <span className="bg-panel-muted border-line text-muted-copy rounded-full border px-3 py-1 text-[11px] font-medium">
                    {formatDayLabel(group.messages[0]?.timestamp ?? 0)}
                  </span>
                </div>
              )}
              <div className="space-y-1">
                {group.messages.map((message) => {
                  const own =
                    Boolean(message.delivery) ||
                    (viewerId !== '' && message.senderId === viewerId)
                  return (
                    <div
                      key={message.id}
                      className={cn(
                        'group flex',
                        own ? 'justify-end' : 'justify-start',
                      )}
                    >
                      <div
                        className={cn(
                          'max-w-[85%] md:max-w-[70%]',
                          own ? 'items-end' : 'items-start',
                          'flex flex-col',
                        )}
                      >
                        <div
                          className={cn(
                            'px-3.5 py-2 text-sm break-words whitespace-pre-wrap',
                            own
                              ? 'button-positive rounded-2xl rounded-br-md'
                              : 'bg-panel-strong border-line text-ink rounded-2xl rounded-bl-md border',
                          )}
                        >
                          <AttachmentBadge message={message} own={own} />
                          {message.text && <span>{message.text}</span>}
                        </div>
                        <div className="text-subtle-copy mt-0.5 flex items-center gap-1 px-1 text-[11px]">
                          <span>{formatClock(message.timestamp)}</span>
                          {own && (
                            <span>
                              {message.delivery === 'sending'
                                ? '· Sending…'
                                : message.delivery === 'unconfirmed'
                                  ? '· Not confirmed'
                                  : seenAt.some(
                                        (seen) =>
                                          seen.userId !== viewerId &&
                                          seen.timestamp >= message.timestamp,
                                      )
                                    ? '· Seen'
                                    : '· Sent'}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => copyMessage(message)}
                            aria-label="Copy message"
                            title="Copy message"
                            className="rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                          >
                            {copiedId === message.id ? (
                              <Check className="size-3" />
                            ) : (
                              <Copy className="size-3" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              {groupIndex < groups.length - 1 && <div className="h-2" />}
            </div>
          ))}
        </div>
        {!stickToBottom && (
          <button
            type="button"
            onClick={() => {
              setStickToBottom(true)
              scrollRef.current?.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: 'smooth',
              })
            }}
            className="bg-panel-strong border-line text-copy absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-lg"
          >
            <ArrowDown className="size-3.5" /> Jump to latest
          </button>
        )}
      </div>

      {selectedThreadId && connected && (
        <form onSubmit={onSend} className="border-line-soft border-t p-3">
          <div className="flex items-end gap-2">
            <Textarea
              ref={composerRef}
              value={draft}
              onChange={(event) =>
                onDraftChange(event.target.value.slice(0, replyMaxLength))
              }
              onKeyDown={sendOnEnter}
              placeholder="Write a reply..."
              aria-label="Reply"
              rows={1}
              className="bg-field brand-focus max-h-40 min-h-10 resize-none shadow-xs"
            />
            <Button
              type="submit"
              size="sm"
              disabled={!draft.trim() || sending}
              className="brand-button h-10 shrink-0 px-3.5"
            >
              <Send /> Send
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

function ConversationSubtitle({
  users,
  profileName,
}: {
  users: { id: string; username: string }[]
  profileName?: string
}) {
  const names = users
    .map((user) => user.username)
    .filter(Boolean)
    .slice(0, 3)
  if (users.length > 3) names.push(`+${users.length - 3} more`)
  if (profileName) names.push(`via ${profileName}`)
  if (names.length === 0) return null
  return (
    <p className="text-subtle-copy truncate text-[11px]">{names.join(' · ')}</p>
  )
}

function AttachmentBadge({
  message,
  own,
}: {
  message: ChatMessage
  own: boolean
}) {
  const label = attachmentLabel(message.kind)
  if (!label || message.text) return null
  const Icon = kindIcon(message.kind)
  return (
    <span
      className={cn(
        'mb-1 flex items-center gap-1.5 text-xs font-medium',
        own ? 'opacity-90' : 'text-muted-copy',
      )}
    >
      <Icon className="size-3.5" /> {label}
    </span>
  )
}

function kindIcon(kind: string) {
  const normalized = kind.toLowerCase()
  if (
    normalized.includes('video') ||
    normalized.includes('clip') ||
    normalized.includes('reel')
  )
    return Video
  if (normalized.includes('voice') || normalized.includes('audio')) return Mic
  if (
    normalized.includes('like') ||
    normalized.includes('reaction') ||
    normalized.includes('heart')
  )
    return Heart
  if (normalized.includes('link')) return Link2
  if (normalized.includes('location')) return MapPin
  if (
    normalized.includes('image') ||
    normalized.includes('media') ||
    normalized.includes('photo') ||
    normalized.includes('story')
  )
    return ImageIcon
  return Paperclip
}

function MessageSkeletons() {
  return (
    <div className="space-y-3" aria-hidden="true" aria-label="Loading messages">
      <div className="flex justify-start">
        <div className="bg-panel-muted h-10 w-48 animate-pulse rounded-2xl rounded-bl-md" />
      </div>
      <div className="flex justify-end">
        <div className="bg-panel-muted h-10 w-56 animate-pulse rounded-2xl rounded-br-md" />
      </div>
      <div className="flex justify-start">
        <div className="bg-panel-muted h-14 w-64 animate-pulse rounded-2xl rounded-bl-md" />
      </div>
      <div className="flex justify-end">
        <div className="bg-panel-muted h-10 w-40 animate-pulse rounded-2xl rounded-br-md" />
      </div>
    </div>
  )
}
