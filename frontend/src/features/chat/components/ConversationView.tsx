import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
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
  SmilePlus,
  Trash2,
  Video,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
  onSendAttachment: (file: Blob, kind: 'photo' | 'video' | 'voice') => void
  onReact: (message: ChatMessage, emoji: string) => void
  reactingMessageId: string | null
  onUnsend: (message: ChatMessage) => void
  unsendingMessageId: string | null
  onError: (message: string) => void
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
  onSendAttachment,
  onReact,
  reactingMessageId,
  onUnsend,
  unsendingMessageId,
  onError,
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
  const contentRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const lastScrollHeightRef = useRef(0)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [stickToBottom, setStickToBottom] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const threadKey = selectedThreadId
  const messageCount = conversation?.messages.length ?? 0
  const latestMessageId = conversation?.messages[0]?.id

  function scrollToLatest() {
    const node = scrollRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
    lastScrollHeightRef.current = node.scrollHeight
  }

  // Open each thread at its latest message.
  useLayoutEffect(() => {
    stickToBottomRef.current = true
    setStickToBottom(true)
    scrollToLatest()
  }, [threadKey])

  useLayoutEffect(() => {
    if (stickToBottomRef.current) scrollToLatest()
  }, [messageCount, latestMessageId, threadKey])

  // Media can change the thread height after the messages first render.
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      if (!stickToBottomRef.current) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(scrollToLatest)
    })
    observer.observe(content)
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [threadKey])

  // Auto-grow composer up to ~160px.
  useEffect(() => {
    const field = composerRef.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${Math.min(field.scrollHeight, 160)}px`
  }, [draft])

  function selectFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const name = file.name.toLowerCase()
    const kind = file.type.startsWith('image/') || /\.(jpe?g|png|webp)$/.test(name) ? 'photo' :
      file.type.startsWith('video/') || name.endsWith('.mp4') ? 'video' :
        file.type.startsWith('audio/') || /\.(m4a|mp3|wav|webm)$/.test(name) ? 'voice' : null
    if (!kind) { onError('Choose a photo, MP4 video, or audio file'); return }
    onSendAttachment(file, kind)
  }

  function handleScroll() {
    const node = scrollRef.current
    if (!node) return
    // Content growth is not the user scrolling up; the resize observer will follow it.
    if (node.scrollHeight !== lastScrollHeightRef.current && stickToBottomRef.current) return
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80
    stickToBottomRef.current = atBottom
    setStickToBottom(atBottom)
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
          Choose a thread from the list to read messages and reply.
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
          <div ref={contentRef} className="flex min-h-full flex-col">
          {loading && !conversation && <MessageSkeletons />}
          {!loading && conversation && groups.length === 0 && (
            <div className="text-muted-copy flex flex-1 items-center justify-center text-sm">
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
                          {message.mediaUrl && message.mediaType === 'photo' && (
                            <img src={message.mediaUrl} alt="Chat photo" loading="lazy"
                              className="max-h-80 max-w-full rounded-lg object-contain" />
                          )}
                          {message.mediaUrl && message.mediaType === 'video' && (
                            <video src={message.mediaUrl} controls preload="metadata"
                              className="max-h-80 max-w-full rounded-lg" />
                          )}
                          {message.mediaUrl && message.mediaType === 'voice' && (
                            <audio src={message.mediaUrl} controls preload="none" className="max-w-full" />
                          )}
                          {message.text && <span>{message.text}</span>}
                        </div>
                        {Boolean(message.reactions?.length) && (
                          <div className="mt-1 flex flex-wrap gap-1 px-1 text-xs">
                            {message.reactions?.map((reaction) =>
                              reaction.senderId === viewerId && /^\d{1,40}$/.test(message.id) ? (
                                <button key={`${reaction.senderId}:${reaction.emoji}`} type="button"
                                  disabled={reactingMessageId === message.id}
                                  onClick={() => onReact(message, reaction.emoji)}
                                  aria-label={`Remove your ${reaction.emoji} reaction`}
                                  title="Remove your reaction"
                                  className="rounded px-1 hover:bg-panel-muted focus-visible:outline">
                                  {reaction.emoji}
                                </button>
                              ) : (
                                <span key={`${reaction.senderId}:${reaction.emoji}`} title="Reaction">
                                  {reaction.emoji}
                                </span>
                              ))}
                          </div>
                        )}
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
                          {/^[0-9]{1,40}$/.test(message.id) && (
                            <ReactionPicker message={message} onReact={onReact}
                              disabled={reactingMessageId === message.id} />
                          )}
                          {own && /^\d{1,40}$/.test(message.id) && (
                            <button type="button" disabled={unsendingMessageId === message.id}
                              onClick={() => {
                                if (window.confirm('Unsend this message for everyone?')) onUnsend(message)
                              }}
                              aria-label="Unsend message" title="Unsend message"
                              className="text-status-danger rounded p-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100">
                              <Trash2 className="size-3" />
                            </button>
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
        </div>
        {!stickToBottom && (
          <button
            type="button"
            onClick={() => {
              stickToBottomRef.current = true
              setStickToBottom(true)
              scrollToLatest()
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
            <input ref={fileRef} type="file" className="hidden"
              accept="image/jpeg,image/png,image/webp,video/mp4,audio/*,.mp3"
              onChange={selectFile} aria-label="Choose chat attachment" />
            <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0"
              disabled={sending} onClick={() => fileRef.current?.click()}
              aria-label="Attach photo, video, or MP3 voice note" title="Attach photo, video, or MP3 voice note">
              <Paperclip />
            </Button>
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
  const label = attachmentLabel(message.mediaType ?? message.kind)
  if (!label || message.text) return null
  const Icon = kindIcon(message.mediaType ?? message.kind)
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

function ReactionPicker({ message, onReact, disabled }: {
  message: ChatMessage
  onReact: (message: ChatMessage, emoji: string) => void
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} aria-label="React to message" title="React to message"
          className="rounded p-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100">
          <SmilePlus className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="flex w-auto gap-1 p-1">
        {['❤️', '😂', '🔥', '😍', '👍', '😮'].map((emoji) => (
          <button key={emoji} type="button" aria-label={`React ${emoji}`}
            onClick={() => { setOpen(false); onReact(message, emoji) }}
            className="rounded px-1.5 py-1 text-lg hover:bg-panel-subtle">
            {emoji}
          </button>
        ))}
      </PopoverContent>
    </Popover>
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
