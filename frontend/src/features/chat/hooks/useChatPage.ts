import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { apiFetch } from '@/lib/api'
import { useAppUser } from '@/lib/auth'
import { useLocation, useNavigate } from '@/lib/router'
import { useProfiles } from '@/features/profiles/hooks/useProfiles'
import type { Profile } from '@/features/profiles/types'
import { errorText, filterThreads, sortThreadsByLatest } from '../utils/chat'
import { preparePhoto, videoMetadata } from '../utils/media'
import {
  clearPendingChatMessage,
  clearProfileChatCache,
  clearThreadChatCache,
  readInboxCache,
  readPendingChatMessages,
  readThreadCache,
  replacePendingChatMessage,
  saveInboxCache,
  savePendingChatMessage,
  saveThreadCache,
} from '../cache'
import type {
  AllChatInbox,
  ChatInbox,
  ChatMessage,
  ChatSession,
  ChatThread,
  OlderChatPage,
} from '../types'

const REPLY_MAX_LENGTH = 1000
type OutgoingReply = { threadKey: string; message: ChatMessage }

function mergeConversation(current: ChatThread | null, incoming: ChatThread): ChatThread {
  if (!current || current.id !== incoming.id || current.profileId !== incoming.profileId ||
    incoming.messages.length === 0) return incoming
  const oldestFetched = Math.min(...incoming.messages.map((message) => message.timestamp))
  const messages = new Map(current.messages.filter((message) => message.timestamp < oldestFetched)
    .map((message) => [message.id, message]))
  for (const message of incoming.messages) messages.set(message.id, message)
  return { ...incoming, messages: [...messages.values()].sort((a, b) => b.timestamp - a.timestamp) }
}

export function useChatPage() {
  const userId = useAppUser()?.id ?? ''
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
  const [visibleCount, setVisibleCount] = useState(10)
  const [olderMessages, setOlderMessages] = useState<ChatMessage[]>([])
  const [olderCursor, setOlderCursor] = useState('')
  const [hasOlder, setHasOlder] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const olderPending = useRef(false)
  const olderRequest = useRef<AbortController | null>(null)
  const activeThreadKey = useRef('')
  const previousNewest = useRef<{ key: string; id: string } | null>(null)
  const [outgoingReplies, setOutgoingReplies] = useState<OutgoingReply[]>([])
  const [draft, setDraft] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [inboxRefresh, setInboxRefresh] = useState(0)
  const [threadRefresh, setThreadRefresh] = useState(0)
  const inboxPending = useRef(false)
  const threadPending = useRef(false)
  const inboxNetworkKey = useRef('')
  const threadNetworkKey = useRef('')
  const [loadingInbox, setLoadingInbox] = useState(false)
  const [loadingThread, setLoadingThread] = useState(false)
  const [sending, setSending] = useState(false)
  const [reactingMessageId, setReactingMessageId] = useState<string | null>(null)
  const [unsendingMessageId, setUnsendingMessageId] = useState<string | null>(null)
  const sendingRef = useRef(false)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [connectedProfileId, setConnectedProfileId] = useState('')
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
    setConnectedProfileId('')
    setConnectOpen(false)
    setCredentials('')
    if (profileId !== activeProfileId) return
    if (activeProfileId === 'all') {
      setConnected(true)
      setConnectedProfileId('all')
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
        if (!controller.signal.aborted) {
          setConnected(data.connected)
          setConnectedProfileId(activeProfileId)
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorText(error))
      })
    return () => controller.abort()
  }, [activeProfileId, profileId, profilesLoading, userId])

  useEffect(() => {
    setInbox(null)
    setConversation(null)
    setOutgoingReplies([])
    setInboxErrors([])
    inboxNetworkKey.current = ''
  }, [activeProfileId, userId])

  useEffect(() => {
    setConversation(null)
    setDraft('')
    threadNetworkKey.current = ''
    setVisibleCount(10)
    setOlderMessages([])
    setOlderCursor('')
    setHasOlder(true)
    setLoadingOlder(false)
    olderPending.current = false
    olderRequest.current?.abort()
    olderRequest.current = null
    previousNewest.current = null
  }, [activeProfileId, selectedThreadId, userId])

  useEffect(() => {
    if (!userId || !connected || connectedProfileId !== activeProfileId) return
    let active = true
    const key = `${userId}:${activeProfileId}`
    void readInboxCache(userId, activeProfileId).then((cached) => {
      if (active && cached && inboxNetworkKey.current !== key) setInbox(cached)
    })
    return () => { active = false }
  }, [userId, activeProfileId, connected, connectedProfileId])

  useEffect(() => {
    if (!userId || !connected || connectedProfileId !== activeProfileId || !selectedThreadId) return
    const targetProfileId = activeProfileId === 'all' ? selectedThreadId.split(':')[0] : activeProfileId
    const targetThreadId = activeProfileId === 'all' ? selectedThreadId.split(':')[1] : selectedThreadId
    if (!targetProfileId || !targetThreadId) return
    let active = true
    const key = `${userId}:${targetProfileId}:${targetThreadId}`
    void readThreadCache(userId, targetProfileId, targetThreadId).then((cached) => {
      if (active && cached && threadNetworkKey.current !== key)
        setConversation({ ...cached, profileId: targetProfileId })
    })
    return () => { active = false }
  }, [userId, activeProfileId, selectedThreadId, connected, connectedProfileId])

  useEffect(() => {
    if (!userId || !selectedThreadId) return
    const targetProfileId = activeProfileId === 'all' ? selectedThreadId.split(':')[0] : activeProfileId
    const targetThreadId = activeProfileId === 'all' ? selectedThreadId.split(':')[1] : selectedThreadId
    if (!targetProfileId || !targetThreadId) return
    const threadKey = `${targetProfileId}:${targetThreadId}`
    let active = true
    void readPendingChatMessages(userId, targetProfileId, targetThreadId).then((messages) => {
      if (!active || !messages.length) return
      setOutgoingReplies((current) => {
        const known = new Set(current.map((reply) => reply.message.id))
        return [...current, ...messages.filter((message) => !known.has(message.id))
          .map((message) => ({ threadKey, message }))]
      })
    })
    return () => { active = false }
  }, [userId, activeProfileId, selectedThreadId])

  useEffect(() => {
    if (profilesLoading || profileId !== activeProfileId || !activeProfileId || !connected ||
      connectedProfileId !== activeProfileId) return
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
        const nextInbox = 'viewerId' in data ? data : { viewerId: '', threads: data.threads }
        inboxNetworkKey.current = `${userId}:${activeProfileId}`
        setInbox(nextInbox)
        if (userId) void saveInboxCache(userId, activeProfileId, nextInbox)
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
  }, [activeProfileId, profileId, connected, connectedProfileId, inboxRefresh, eligibleProfiles.length, profilesLoading, userId])

  useEffect(() => {
    const targetProfileId =
      activeProfileId === 'all'
        ? selectedThreadId.split(':')[0]
        : activeProfileId
    const targetThreadId =
      activeProfileId === 'all'
        ? selectedThreadId.split(':')[1]
        : selectedThreadId
    if (profilesLoading || profileId !== activeProfileId || !targetProfileId || !connected ||
      connectedProfileId !== activeProfileId || !targetThreadId) return
    const controller = new AbortController()
    threadPending.current = true
    setLoadingThread(true)
    apiFetch<ChatThread>(
      `/api/chat/${encodeURIComponent(targetProfileId)}/threads/${targetThreadId}`,
      { signal: controller.signal, maxRetries: 1 },
    )
      .then((data) => {
        if (controller.signal.aborted) return
        threadNetworkKey.current = `${userId}:${targetProfileId}:${targetThreadId}`
        const scoped = { ...data, profileId: targetProfileId }
        setConversation((current) => mergeConversation(current, scoped))
        if (userId && data) void saveThreadCache(userId, targetProfileId, targetThreadId, scoped)
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
  }, [activeProfileId, profileId, connected, connectedProfileId, selectedThreadId, threadRefresh, profilesLoading, userId])

  useEffect(() => {
    const newest = conversation?.messages[0]?.id
    if (!newest) return
    const key = `${activeProfileId}:${selectedThreadId}`
    const previous = previousNewest.current
    if (olderMessages.length === 0 && previous?.key === key && previous.id !== newest) {
      const added = conversation.messages.findIndex((message) => message.id === previous.id)
      if (added > 0) setVisibleCount((count) => count + added)
    }
    previousNewest.current = { key, id: newest }
  }, [conversation, activeProfileId, selectedThreadId, olderMessages.length])

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
  activeThreadKey.current = selectedReplyKey
  const displayedConversation = useMemo(() => {
    const local = outgoingReplies.filter(
      (reply) => reply.threadKey === selectedReplyKey,
    )
    const base =
      conversation ??
      (selectedThread ? { ...selectedThread, messages: [] } : null)
    if (!base) return null
    const visible = olderMessages.length ? base.messages : base.messages.slice(0, visibleCount)
    const confirmedIds = new Set(conversation?.confirmedMessageIds ?? [])
    const pendingById = new Map(local.map((reply) => [reply.message.id, reply.message]))
    const pendingByContext = new Map(local.filter((reply) => reply.message.clientContext)
      .map((reply) => [reply.message.clientContext, reply.message]))
    const showPending = (message: ChatMessage): ChatMessage => {
      const pending = pendingById.get(message.id) || pendingByContext.get(message.clientContext)
      return pending && !confirmedIds.has(message.id)
        ? { ...message, delivery: pending.delivery ?? 'unconfirmed' } : message
    }
    const ids = new Set([...base.messages, ...olderMessages].map((message) => message.id))
    const contexts = new Set(
      base.messages.map((message) => message.clientContext).filter(Boolean),
    )
    const messages = [
      ...visible.map(showPending),
      ...olderMessages.filter((message) => !visible.some((item) => item.id === message.id)),
      ...local
        .map((reply) => reply.message)
        .filter(
          (message) =>
            !ids.has(message.id) && !contexts.has(message.clientContext),
        ),
    ]
      .sort((a, b) => b.timestamp - a.timestamp)
    return { ...base, messages }
  }, [conversation, visibleCount, olderMessages, outgoingReplies, selectedReplyKey, selectedThread])

  async function loadOlder(): Promise<boolean> {
    if (olderPending.current || !conversation || !selectedThreadId) return false
    if (olderMessages.length === 0 && visibleCount < conversation.messages.length) {
      setVisibleCount((count) => Math.min(count + 10, conversation.messages.length))
      return true
    }
    if (!hasOlder) return false
    const oldest = olderMessages.at(-1) ?? conversation.messages.at(-1)
    if (!oldest?.timestamp) return false
    const targetProfileId = activeProfileId === 'all' ? selectedThreadId.split(':')[0] : activeProfileId
    const targetThreadId = activeProfileId === 'all' ? selectedThreadId.split(':')[1] : selectedThreadId
    if (!targetProfileId || !targetThreadId) return false
    olderPending.current = true
    setLoadingOlder(true)
    const controller = new AbortController()
    olderRequest.current = controller
    try {
      const params = new URLSearchParams({ before: String(oldest.timestamp), beforeId: oldest.id,
        cursor: olderCursor })
      const page = await apiFetch<OlderChatPage>(
        `/api/chat/${encodeURIComponent(targetProfileId)}/threads/${targetThreadId}/older?${params}`,
        { maxRetries: 1, timeout: 60_000, signal: controller.signal },
      )
      if (controller.signal.aborted || activeThreadKey.current !== `${targetProfileId}:${targetThreadId}`) return false
      setOlderCursor(page.nextCursor)
      setHasOlder(page.hasOlder)
      const known = new Set([...conversation.messages, ...olderMessages].map((message) => message.id))
      const added = page.messages.filter((message) => !known.has(message.id))
      if (added.length) setOlderMessages((current) => [...current, ...added].sort((a, b) => b.timestamp - a.timestamp))
      return added.length > 0
    } catch (error) {
      if (!controller.signal.aborted) setError(errorText(error))
      return false
    } finally {
      if (olderRequest.current === controller) {
        olderRequest.current = null
        olderPending.current = false
        setLoadingOlder(false)
      }
    }
  }

  useEffect(() => {
    if (!conversation || !selectedReplyKey) return
    const ids = new Set(conversation.confirmedMessageIds ?? [])
    const contexts = new Set(
      conversation.messages
        .filter((message) => ids.has(message.id))
        .map((message) => message.clientContext)
        .filter(Boolean),
    )
    const confirmed = outgoingReplies.filter((reply) => reply.threadKey === selectedReplyKey &&
      (ids.has(reply.message.id) || contexts.has(reply.message.clientContext)))
    if (!confirmed.length) return
    setOutgoingReplies((current) => current.filter((reply) => !confirmed.includes(reply)))
    if (userId) {
      const [profileId, threadId] = selectedReplyKey.split(':')
      for (const reply of confirmed)
        void clearPendingChatMessage(userId, profileId, threadId, reply.message.id)
    }
  }, [conversation, selectedReplyKey, outgoingReplies, userId])

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
    setDraft('')
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
      if (userId) await clearProfileChatCache(userId, activeProfileId)
      setConnectOpen(false)
      setConnected(true)
      setConnectedProfileId(activeProfileId)
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
      setConnectedProfileId(activeProfileId)
      if (userId) await clearProfileChatCache(userId, activeProfileId)
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
      if (userId) await savePendingChatMessage(userId, targetProfileId, targetThreadId,
        { ...localMessage, delivery: 'unconfirmed' })
      const result = await apiFetch<{ success: true; message: ChatMessage }>(
        `/api/chat/${encodeURIComponent(targetProfileId)}/threads/${targetThreadId}/reply`,
        {
          method: 'POST',
          body: { text, clientContext },
          maxRetries: 1,
          timeout: 60_000,
        },
      )
      const pendingMessage: ChatMessage = {
        ...result.message,
        text,
        senderId: result.message.senderId || viewerId,
        timestamp: result.message.timestamp || localMessage.timestamp,
        clientContext,
        delivery: 'unconfirmed',
      }
      if (userId) await replacePendingChatMessage(userId, targetProfileId, targetThreadId,
        localId, pendingMessage)
      setOutgoingReplies((current) =>
        current.map((reply) =>
          reply.message.id === localId
            ? { ...reply, message: pendingMessage }
            : reply,
        ),
      )
      setThreadRefresh((value) => value + 1)
      setInboxRefresh((value) => value + 1)
    } catch (error) {
      if (userId) await savePendingChatMessage(userId, targetProfileId, targetThreadId,
        { ...localMessage, delivery: 'unconfirmed' })
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
    let pendingMessage: ChatMessage | null = null
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
      pendingMessage = localMessage
      setOutgoingReplies((current) => [...current, { threadKey: replyKey, message: localMessage }])
      if (userId) await savePendingChatMessage(userId, targetProfileId, targetThreadId,
        { ...localMessage, delivery: 'unconfirmed' })
      const query = new URLSearchParams({ kind, clientContext })
      if (metadata) for (const [key, value] of Object.entries(metadata)) query.set(key, String(value))
      const result = await apiFetch<{ success: true; message: ChatMessage }>(
        `/api/chat/${encodeURIComponent(targetProfileId)}/threads/${targetThreadId}/attachment?${query}`,
        { method: 'POST', body: prepared, maxRetries: 1, timeout: 300_000 },
      )
      const sentMessage: ChatMessage = { ...result.message, senderId: result.message.senderId || viewerId,
        timestamp: result.message.timestamp || localMessage.timestamp,
        mediaType: kind, clientContext, delivery: 'unconfirmed' }
      pendingMessage = sentMessage
      if (userId) await replacePendingChatMessage(userId, targetProfileId, targetThreadId,
        localId, sentMessage)
      setOutgoingReplies((current) => current.map((reply) => reply.message.id === localId
        ? { ...reply, message: sentMessage }
        : reply))
      setThreadRefresh((value) => value + 1)
      setInboxRefresh((value) => value + 1)
    } catch (error) {
      if (userId && pendingMessage) await savePendingChatMessage(userId, targetProfileId, targetThreadId,
        { ...pendingMessage, delivery: 'unconfirmed' })
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
    setOlderMessages((current) => current.map((item) =>
      item.id === message.id ? { ...item, reactions: next } : item))
    setReactingMessageId(message.id)
    setError('')
    try {
      await apiFetch(`/api/chat/${encodeURIComponent(targetProfileId)}/threads/${targetThreadId}/reaction`,
        { method: 'POST', body: { messageId: message.id, kind: message.kind,
          clientContext: message.clientContext, emoji, remove }, maxRetries: 1, timeout: 60_000 })
    } catch (error) {
      setConversation((current) => current && ({ ...current, messages: current.messages.map((item) =>
        item.id === message.id ? { ...item, reactions: previous } : item) }))
      setOlderMessages((current) => current.map((item) =>
        item.id === message.id ? { ...item, reactions: previous } : item))
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
      if (userId) await Promise.all([
        clearPendingChatMessage(userId, targetProfileId, targetThreadId, message.id),
        clearThreadChatCache(userId, targetThreadId),
      ])
      const fallback = conversation?.messages.filter((item) => item.id !== message.id)
        .sort((a, b) => b.timestamp - a.timestamp)[0]
      setConversation((current) => current?.id === targetThreadId
        ? { ...current, messages: current.messages.filter((item) => item.id !== message.id) } : current)
      setOlderMessages((current) => current.filter((item) => item.id !== message.id))
      setOutgoingReplies((current) => current.filter((reply) =>
        reply.threadKey !== `${targetProfileId}:${targetThreadId}` || reply.message.id !== message.id))
      setInbox((current) => current && ({ ...current, threads: current.threads.map((thread) =>
        thread.id === targetThreadId && thread.messages[0]?.id === message.id
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
    hasOlder: (olderMessages.length === 0 && visibleCount < (conversation?.messages.length ?? 0)) || hasOlder,
    loadingOlder,
    loadOlder,
    draft,
    setDraft,
    searchQuery,
    setSearchQuery,
    loadingInbox,
    loadingThread,
    sending,
    reactingMessageId,
    unsendingMessageId,
    connected: connectedProfileId === activeProfileId ? connected : null,
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
