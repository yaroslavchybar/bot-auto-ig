import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { apiFetch } from '@/lib/api'
import { useLocation, useNavigate } from '@/lib/router'
import { useProfiles } from '@/features/profiles/hooks/useProfiles'
import type { Profile } from '@/features/profiles/types'
import { errorText, filterThreads, sortThreadsByLatest } from '../utils/chat'
import { preparePhoto, videoMetadata } from '../utils/media'
import type {
  AllChatInbox,
  ChatInbox,
  ChatMessage,
  ChatSession,
  ChatThread,
} from '../types'

const REPLY_MAX_LENGTH = 1000
type OutgoingReply = { threadKey: string; message: ChatMessage }

export function useChatPage() {
  const { search } = useLocation()
  const navigate = useNavigate()
  const selection = new URLSearchParams(search)
  const profileId = selection.get('profile') || 'all'
  const rawThreadId = selection.get('thread') || ''
  const selectedThreadId = (profileId === 'all'
    ? /^[a-z0-9_-]{1,80}:\d{1,40}$/i
    : /^\d{1,40}$/).test(rawThreadId) ? rawThreadId : ''
  const { profiles, loading: profilesLoading } = useProfiles()
  const eligibleProfiles = useMemo(
    () =>
      profiles.filter(
        (profile: Profile) =>
          profile.igLoggedIn && profile.status !== 'deleting',
      ),
    [profiles],
  )
  const activeProfileId =
    profileId === 'all' ||
    profilesLoading ||
    eligibleProfiles.some((profile: Profile) => profile.id === profileId)
      ? profileId
      : 'all'
  const activeProfile = eligibleProfiles.find(
    (profile: Profile) => profile.id === activeProfileId,
  )

  const [inbox, setInbox] = useState<ChatInbox | null>(null)
  const [inboxErrors, setInboxErrors] = useState<string[]>([])
  const [conversation, setConversation] = useState<ChatThread | null>(null)
  const [outgoingReplies, setOutgoingReplies] = useState<OutgoingReply[]>([])
  const [draft, setDraft] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [inboxRefresh, setInboxRefresh] = useState(0)
  const [threadRefresh, setThreadRefresh] = useState(0)
  const inboxPending = useRef(false)
  const threadPending = useRef(false)
  const [loadingInbox, setLoadingInbox] = useState(false)
  const [loadingThread, setLoadingThread] = useState(false)
  const [sending, setSending] = useState(false)
  const [reactingMessageId, setReactingMessageId] = useState<string | null>(null)
  const [unsendingMessageId, setUnsendingMessageId] = useState<string | null>(null)
  const sendingRef = useRef(false)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [connectOpen, setConnectOpen] = useState(false)
  const [credentials, setCredentials] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState('')
  // Ticking clock so relative timestamps ("5m ago") stay fresh.
  const [now, setNow] = useState(() => Date.now())

  function updateSelection(nextProfileId: string, nextThreadId = '') {
    const next = new URLSearchParams()
    if (nextProfileId !== 'all') next.set('profile', nextProfileId)
    if (nextThreadId) next.set('thread', nextThreadId)
    const query = next.toString()
    navigate(`/chat${query ? `?${query}` : ''}`, { replace: true })
  }

  useEffect(() => {
    if (!profilesLoading && profileId !== activeProfileId) navigate('/chat', { replace: true })
  }, [profilesLoading, profileId, activeProfileId, navigate])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!connected) return
    const inboxTimer = setInterval(() => {
      if (!inboxPending.current && document.visibilityState === 'visible')
        setInboxRefresh((value) => value + 1)
    }, 60_000)
    const threadTimer = setInterval(() => {
      if (
        !threadPending.current &&
        selectedThreadId &&
        document.visibilityState === 'visible'
      )
        setThreadRefresh((value) => value + 1)
    }, 20_000)
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (!inboxPending.current) setInboxRefresh((value) => value + 1)
      if (!threadPending.current && selectedThreadId)
        setThreadRefresh((value) => value + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(inboxTimer)
      clearInterval(threadTimer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [connected, selectedThreadId])

  useEffect(() => {
    if (profilesLoading) return
    setConnected(null)
    setConnectOpen(false)
    setCredentials('')
    if (profileId !== activeProfileId) return
    if (activeProfileId === 'all') {
      setConnected(true)
      return
    }
    const controller = new AbortController()
    apiFetch<ChatSession>(
      `/api/chat/${encodeURIComponent(activeProfileId)}/session`,
      {
        signal: controller.signal,
        maxRetries: 1,
      },
    )
      .then((data) => {
        if (!controller.signal.aborted) setConnected(data.connected)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorText(error))
      })
    return () => controller.abort()
  }, [activeProfileId, profileId, profilesLoading])

  useEffect(() => {
    setInbox(null)
    setConversation(null)
    setInboxErrors([])
  }, [activeProfileId])

  useEffect(() => {
    setConversation(null)
  }, [activeProfileId, selectedThreadId])

  useEffect(() => {
    if (profilesLoading || profileId !== activeProfileId || !activeProfileId || !connected) return
    const controller = new AbortController()
    inboxPending.current = true
    setLoadingInbox(true)
    apiFetch<ChatInbox | AllChatInbox>(
      `${activeProfileId === 'all' ? '/api/chat/threads' : `/api/chat/${encodeURIComponent(activeProfileId)}/threads`}`,
      {
        signal: controller.signal,
        maxRetries: 1,
        timeout:
          activeProfileId === 'all'
            ? Math.max(60_000, Math.ceil(eligibleProfiles.length / 4) * 25_000)
            : 30_000,
      },
    )
      .then((data) => {
        if (controller.signal.aborted) return
        setInbox(
          'viewerId' in data ? data : { viewerId: '', threads: data.threads },
        )
        setInboxErrors([])
        if ('errors' in data)
          setInboxErrors(data.errors.map((item) => item.profileName))
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorText(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          inboxPending.current = false
          setLoadingInbox(false)
        }
      })
    return () => {
      controller.abort()
      inboxPending.current = false
    }
  }, [activeProfileId, profileId, connected, inboxRefresh, eligibleProfiles.length, profilesLoading])

  useEffect(() => {
    const targetProfileId =
      activeProfileId === 'all'
        ? selectedThreadId.split(':')[0]
        : activeProfileId
    const targetThreadId =
      activeProfileId === 'all'
        ? selectedThreadId.split(':')[1]
        : selectedThreadId
    if (profilesLoading || profileId !== activeProfileId || !targetProfileId || !connected || !targetThreadId) return
    const controller = new AbortController()
    threadPending.current = true
    setLoadingThread(true)
    apiFetch<ChatThread>(
      `/api/chat/${encodeURIComponent(targetProfileId)}/threads/${targetThreadId}`,
      { signal: controller.signal, maxRetries: 1 },
    )
      .then((data) => {
        if (controller.signal.aborted) return
        setConversation(data)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorText(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          threadPending.current = false
          setLoadingThread(false)
        }
      })
    return () => {
      controller.abort()
      threadPending.current = false
    }
  }, [activeProfileId, profileId, connected, selectedThreadId, threadRefresh, profilesLoading])

  const threads = useMemo(
    () =>
      sortThreadsByLatest(
        (inbox?.threads ?? []).map((thread) => {
          const key = `${thread.profileId ?? activeProfileId}:${thread.id}`
          const latest = outgoingReplies
            .filter((reply) => reply.threadKey === key)
            .sort(
              (a, b) => b.message.timestamp - a.message.timestamp,
            )[0]?.message
          return latest &&
            latest.timestamp >= (thread.messages[0]?.timestamp ?? 0)
            ? { ...thread, messages: [latest] }
            : thread
        }),
      ),
    [inbox, activeProfileId, outgoingReplies],
  )
  const visibleThreads = useMemo(
    () => filterThreads(threads, searchQuery),
    [threads, searchQuery],
  )
  const selectedThread = useMemo(
    () =>
      threads.find(
        (thread) =>
          (thread.profileId
            ? `${thread.profileId}:${thread.id}`
            : thread.id) === selectedThreadId,
      ),
    [threads, selectedThreadId],
  )
  const selectedReplyKey = selectedThreadId
    ? activeProfileId === 'all'
      ? selectedThreadId
      : `${activeProfileId}:${selectedThreadId}`
    : ''
  const displayedConversation = useMemo(() => {
    const local = outgoingReplies.filter(
      (reply) => reply.threadKey === selectedReplyKey,
    )
    if (local.length === 0) return conversation
    const base =
      conversation ??
      (selectedThread ? { ...selectedThread, messages: [] } : null)
    if (!base) return null
    const ids = new Set(base.messages.map((message) => message.id))
    const contexts = new Set(
      base.messages.map((message) => message.clientContext).filter(Boolean),
    )
    const messages = [
      ...base.messages,
      ...local
        .map((reply) => reply.message)
        .filter(
          (message) =>
            !ids.has(message.id) && !contexts.has(message.clientContext),
        ),
    ]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 20)
    return { ...base, messages }
  }, [conversation, outgoingReplies, selectedReplyKey, selectedThread])

  useEffect(() => {
    if (!conversation || !selectedReplyKey) return
    const ids = new Set(conversation.messages.map((message) => message.id))
    const contexts = new Set(
      conversation.messages
        .map((message) => message.clientContext)
        .filter(Boolean),
    )
    setOutgoingReplies((current) => {
      const next = current.filter(
        (reply) =>
          reply.threadKey !== selectedReplyKey ||
          (!ids.has(reply.message.id) &&
            !contexts.has(reply.message.clientContext)),
      )
      return next.length === current.length ? current : next
    })
  }, [conversation, selectedReplyKey, outgoingReplies])

  useEffect(() => {
    if (!inbox) return
    setOutgoingReplies((current) => {
      const next = current.filter(
        (reply) =>
          !inbox.threads.some((thread) => {
            const key = `${thread.profileId ?? activeProfileId}:${thread.id}`
            return (
              key === reply.threadKey &&
              thread.messages.some(
                (message) =>
                  message.id === reply.message.id ||
                  Boolean(
                    reply.message.clientContext &&
                    message.clientContext === reply.message.clientContext,
                  ),
              )
            )
          }),
      )
      return next.length === current.length ? current : next
    })
  }, [inbox, activeProfileId])

  function selectProfile(id: string) {
    updateSelection(id)
    setDraft('')
    setSearchQuery('')
    setCredentials('')
    setError('')
  }

  function selectThread(id: string) {
    setError('')
    if (id === selectedThreadId) return
    setConversation(null)
    updateSelection(activeProfileId, id)
  }

  async function connect(event: FormEvent) {
    event.preventDefault()
    if (!activeProfile || connecting || loggingOut) return
    setConnecting(true)
    setError('')
    try {
      const result = await apiFetch<ChatSession>(
        `/api/chat/${encodeURIComponent(activeProfileId)}/session`,
        { method: 'POST', body: { credentials }, timeout: 60_000 },
      )
      if (!result.connected) throw new Error('Instagram Chat did not connect')
      setConnectOpen(false)
      setConnected(true)
      setInboxRefresh((value) => value + 1)
    } catch (error) {
      setError(errorText(error))
    } finally {
      setCredentials('')
      setConnecting(false)
    }
  }

  async function logout() {
    if (!activeProfile || loggingOut || connecting || sending) return
    setLoggingOut(true)
    setError('')
    try {
      await apiFetch<ChatSession>(
        `/api/chat/${encodeURIComponent(activeProfileId)}/session`,
        {
          method: 'DELETE',
        },
      )
      setConnected(false)
      setConnectOpen(false)
      setInbox(null)
      setConversation(null)
      updateSelection(activeProfileId)
      setDraft('')
      setCredentials('')
    } catch (error) {
      setError(errorText(error))
    } finally {
      setLoggingOut(false)
    }
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!selectedThreadId || !text || sendingRef.current || loggingOut) return
    const targetProfileId =
      activeProfileId === 'all'
        ? selectedThreadId.split(':')[0]
        : activeProfileId
    const targetThreadId =
      activeProfileId === 'all'
        ? selectedThreadId.split(':')[1]
        : selectedThreadId
    if (!targetProfileId || !targetThreadId) return
    sendingRef.current = true
    const replyKey = `${targetProfileId}:${targetThreadId}`
    const viewerId = selectedThread?.viewerId ?? inbox?.viewerId ?? ''
    const clientContext = crypto.randomUUID()
    const localId = `local:${clientContext}`
    const localMessage: ChatMessage = {
      id: localId,
      senderId: viewerId,
      text,
      timestamp: Math.max(
        Date.now(),
        (conversation?.messages[0]?.timestamp ?? 0) + 1,
      ),
      kind: 'text',
      clientContext,
      delivery: 'sending',
    }
    setOutgoingReplies((current) => [
      ...current,
      { threadKey: replyKey, message: localMessage },
    ])
    setDraft('')
    setSending(true)
    setError('')
    try {
      const result = await apiFetch<{ success: true; message: ChatMessage }>(
        `/api/chat/${encodeURIComponent(targetProfileId)}/threads/${targetThreadId}/reply`,
        {
          method: 'POST',
          body: { text, clientContext },
          maxRetries: 1,
          timeout: 60_000,
        },
      )
      setOutgoingReplies((current) =>
        current.map((reply) =>
          reply.message.id === localId
            ? {
                ...reply,
                message: {
                  ...result.message,
                  text,
                  senderId: result.message.senderId || viewerId,
                  timestamp: result.message.timestamp || localMessage.timestamp,
                  clientContext,
                  delivery: 'sent',
                },
              }
            : reply,
        ),
      )
      setThreadRefresh((value) => value + 1)
      setInboxRefresh((value) => value + 1)
    } catch (error) {
      setOutgoingReplies((current) =>
        current.map((reply) =>
          reply.message.id === localId
            ? {
                ...reply,
                message: { ...reply.message, delivery: 'unconfirmed' },
              }
            : reply,
        ),
      )
      setError(
        `${errorText(error)}. Check the conversation before trying again; the reply may have been sent.`,
      )
      setThreadRefresh((value) => value + 1)
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  async function sendAttachment(file: Blob, kind: 'photo' | 'video' | 'voice') {
    if (!selectedThreadId || sendingRef.current || loggingOut) return
    const targetProfileId = activeProfileId === 'all' ? selectedThreadId.split(':')[0] : activeProfileId
    const targetThreadId = activeProfileId === 'all' ? selectedThreadId.split(':')[1] : selectedThreadId
    if (!targetProfileId || !targetThreadId) return
    sendingRef.current = true
    setSending(true)
    setError('')
    let localId = ''
    try {
      if (file.size === 0 || file.size > 25_000_000) throw new Error('Choose a file under 25 MB')
      if (kind === 'video' && file instanceof File &&
        file.type !== 'video/mp4' && !file.name.toLowerCase().endsWith('.mp4')) {
        throw new Error('Choose an H.264 MP4 video')
      }
      const prepared = kind === 'photo' ? await preparePhoto(file) : file
      const metadata = kind === 'video' ? await videoMetadata(prepared) : undefined
      const sizeLimit = kind === 'video' ? 25_000_000 : 10_000_000
      if (prepared.size > sizeLimit) throw new Error(`File is too large for ${kind}`)
      const clientContext = crypto.randomUUID()
      localId = `local:${clientContext}`
      const viewerId = selectedThread?.viewerId ?? inbox?.viewerId ?? ''
      const replyKey = `${targetProfileId}:${targetThreadId}`
      const localMessage: ChatMessage = { id: localId, senderId: viewerId, text: '',
        timestamp: Math.max(Date.now(), (conversation?.messages[0]?.timestamp ?? 0) + 1),
        kind, mediaType: kind, clientContext, delivery: 'sending' }
      setOutgoingReplies((current) => [...current, { threadKey: replyKey, message: localMessage }])
      const query = new URLSearchParams({ kind, clientContext })
      if (metadata) for (const [key, value] of Object.entries(metadata)) query.set(key, String(value))
      const result = await apiFetch<{ success: true; message: ChatMessage }>(
        `/api/chat/${encodeURIComponent(targetProfileId)}/threads/${targetThreadId}/attachment?${query}`,
        { method: 'POST', body: prepared, maxRetries: 1, timeout: 300_000 },
      )
      setOutgoingReplies((current) => current.map((reply) => reply.message.id === localId
        ? { ...reply, message: { ...result.message, senderId: result.message.senderId || viewerId,
          timestamp: result.message.timestamp || localMessage.timestamp,
          mediaType: kind, clientContext, delivery: 'sent' } }
        : reply))
      setThreadRefresh((value) => value + 1)
      setInboxRefresh((value) => value + 1)
    } catch (error) {
      if (localId) setOutgoingReplies((current) => current.map((reply) => reply.message.id === localId
        ? { ...reply, message: { ...reply.message, delivery: 'unconfirmed' } } : reply))
      setError(localId
        ? `${errorText(error)}. Check the conversation before trying again; it may have been sent.`
        : errorText(error))
      if (localId) setThreadRefresh((value) => value + 1)
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  async function reactToMessage(message: ChatMessage, emoji: string) {
    if (!selectedThreadId || reactingMessageId || !/^\d{1,40}$/.test(message.id)) return
    const targetProfileId = activeProfileId === 'all' ? selectedThreadId.split(':')[0] : activeProfileId
    const targetThreadId = activeProfileId === 'all' ? selectedThreadId.split(':')[1] : selectedThreadId
    if (!targetProfileId || !targetThreadId) return
    const viewerId = selectedThread?.viewerId ?? inbox?.viewerId ?? ''
    const previous = message.reactions ?? []
    const remove = previous.some((reaction) => reaction.senderId === viewerId && reaction.emoji === emoji)
    const next = previous.filter((reaction) => reaction.senderId !== viewerId)
    if (!remove && viewerId) next.push({ senderId: viewerId, emoji })
    setConversation((current) => current && ({ ...current, messages: current.messages.map((item) =>
      item.id === message.id ? { ...item, reactions: next } : item) }))
    setReactingMessageId(message.id)
    setError('')
    try {
      await apiFetch(`/api/chat/${encodeURIComponent(targetProfileId)}/threads/${targetThreadId}/reaction`,
        { method: 'POST', body: { messageId: message.id, kind: message.kind,
          clientContext: message.clientContext, emoji, remove }, maxRetries: 1, timeout: 60_000 })
    } catch (error) {
      setConversation((current) => current && ({ ...current, messages: current.messages.map((item) =>
        item.id === message.id ? { ...item, reactions: previous } : item) }))
      setError(`${errorText(error)}. Refresh the conversation to check the reaction.`)
    } finally { setReactingMessageId(null) }
  }

  async function unsendMessage(message: ChatMessage) {
    if (!selectedThreadId || unsendingMessageId || !/^\d{1,40}$/.test(message.id)) return
    const targetProfileId = activeProfileId === 'all' ? selectedThreadId.split(':')[0] : activeProfileId
    const targetThreadId = activeProfileId === 'all' ? selectedThreadId.split(':')[1] : selectedThreadId
    const viewerId = selectedThread?.viewerId ?? inbox?.viewerId ?? ''
    if (!targetProfileId || !targetThreadId || !viewerId || message.senderId !== viewerId) return
    setUnsendingMessageId(message.id)
    setError('')
    try {
      await apiFetch(`/api/chat/${encodeURIComponent(targetProfileId)}/threads/${targetThreadId}/unsend`,
        { method: 'POST', body: { messageId: message.id }, maxRetries: 1, timeout: 60_000 })
      const fallback = conversation?.messages.filter((item) => item.id !== message.id)
        .sort((a, b) => b.timestamp - a.timestamp)[0]
      setConversation((current) => current?.id === targetThreadId
        ? { ...current, messages: current.messages.filter((item) => item.id !== message.id) } : current)
      setOutgoingReplies((current) => current.filter((reply) =>
        reply.threadKey !== `${targetProfileId}:${targetThreadId}` || reply.message.id !== message.id))
      setInbox((current) => current && ({ ...current, threads: current.threads.map((thread) =>
        thread.id === targetThreadId && (thread.profileId ?? activeProfileId) === targetProfileId &&
        thread.messages[0]?.id === message.id
          ? { ...thread, messages: fallback ? [fallback] : [] } : thread) }))
      setThreadRefresh((value) => value + 1)
      setInboxRefresh((value) => value + 1)
    } catch (error) {
      setError(`${errorText(error)}. Refresh the conversation to check whether the message was unsent.`)
    } finally { setUnsendingMessageId(null) }
  }

  return {
    profiles: eligibleProfiles,
    profilesLoading,
    activeProfileId,
    activeProfile,
    inbox,
    inboxErrors,
    threads,
    visibleThreads,
    selectedThread,
    conversation: displayedConversation,
    draft,
    setDraft,
    searchQuery,
    setSearchQuery,
    loadingInbox,
    loadingThread,
    sending,
    reactingMessageId,
    unsendingMessageId,
    connected,
    connectOpen,
    setConnectOpen,
    credentials,
    setCredentials,
    connecting,
    loggingOut,
    error,
    setError,
    now,
    selectedThreadId,
    selectProfile,
    selectThread,
    connect,
    logout,
    sendReply,
    sendAttachment,
    reactToMessage,
    unsendMessage,
    replyMaxLength: REPLY_MAX_LENGTH,
  }
}

export type ChatPageState = ReturnType<typeof useChatPage>
