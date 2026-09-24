import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { apiFetch } from '@/lib/api'
import { useProfiles } from '@/features/profiles/hooks/useProfiles'
import type { Profile } from '@/features/profiles/types'
import { errorText, filterThreads, sortThreadsByLatest } from '../utils/chat'
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
  const { profiles, loading: profilesLoading } = useProfiles()
  const eligibleProfiles = useMemo(
    () =>
      profiles.filter(
        (profile: Profile) =>
          profile.igLoggedIn && profile.status !== 'deleting',
      ),
    [profiles],
  )
  const [profileId, setProfileId] = useState('all')
  const activeProfileId =
    profileId === 'all' ||
    eligibleProfiles.some((profile: Profile) => profile.id === profileId)
      ? profileId
      : 'all'
  const activeProfile = eligibleProfiles.find(
    (profile: Profile) => profile.id === activeProfileId,
  )

  const [inbox, setInbox] = useState<ChatInbox | null>(null)
  const [inboxErrors, setInboxErrors] = useState<string[]>([])
  const [selectedThreadId, setSelectedThreadId] = useState('')
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
  const sendingRef = useRef(false)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [connectOpen, setConnectOpen] = useState(false)
  const [credentials, setCredentials] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState('')
  // Ticking clock so relative timestamps ("5m ago") stay fresh.
  const [now, setNow] = useState(() => Date.now())

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
    setConnected(null)
    setConnectOpen(false)
    setCredentials('')
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
  }, [activeProfileId])

  useEffect(() => {
    setInbox(null)
    setConversation(null)
    setInboxErrors([])
  }, [activeProfileId])

  useEffect(() => {
    setConversation(null)
  }, [activeProfileId, selectedThreadId])

  useEffect(() => {
    if (!activeProfileId || !connected) return
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
        if (!('errors' in data) || data.errors.length === 0) {
          setSelectedThreadId((current) =>
            current &&
            !data.threads.some(
              (thread) =>
                (thread.profileId
                  ? `${thread.profileId}:${thread.id}`
                  : thread.id) === current,
            )
              ? ''
              : current,
          )
        }
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
  }, [activeProfileId, connected, inboxRefresh, eligibleProfiles.length])

  useEffect(() => {
    const targetProfileId =
      activeProfileId === 'all'
        ? selectedThreadId.split(':')[0]
        : activeProfileId
    const targetThreadId =
      activeProfileId === 'all'
        ? selectedThreadId.split(':')[1]
        : selectedThreadId
    if (!targetProfileId || !connected || !targetThreadId) return
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
  }, [activeProfileId, connected, selectedThreadId, threadRefresh])

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
    setProfileId(id)
    setSelectedThreadId('')
    setDraft('')
    setSearchQuery('')
    setCredentials('')
    setError('')
  }

  function selectThread(id: string) {
    setError('')
    setSelectedThreadId(id)
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
      setSelectedThreadId('')
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
    replyMaxLength: REPLY_MAX_LENGTH,
  }
}

export type ChatPageState = ReturnType<typeof useChatPage>
