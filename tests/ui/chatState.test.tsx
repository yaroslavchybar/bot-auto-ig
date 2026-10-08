import { act, useEffect } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { useChatPage, type ChatPageState } from '@/features/chat/hooks/useChatPage'
import type { ChatMessage, ChatThread } from '@/features/chat/types'
import { mount } from './mount'

const mocks = vi.hoisted(() => ({
  userId: 'user',
  search: '?profile=profile&thread=1',
  apiFetch: vi.fn(),
  navigate: vi.fn(),
  onEvent: null as
    | null
    | ((event: { type: string; profileId?: string; archivesChanged?: boolean }) => void),
  readArchives: vi.fn<() => Promise<{ profileId: string; threadId: string }[]>>(),
  archiveRows: [] as { profileId: string; threadId: string }[],
  setArchive: vi.fn<(args: Record<string, unknown>) => Promise<void>>(() => Promise.resolve()),
  clearPending: vi.fn(() => Promise.resolve()),
  readPending: vi.fn<() => Promise<ChatMessage[]>>(() => Promise.resolve([])),
  profiles: [{ id: 'profile', name: 'Profile', igLoggedIn: true, status: 'idle' }],
}))

vi.mock('@/lib/auth', () => ({ useAppUser: () => ({ id: mocks.userId }) }))
vi.mock('@/lib/router', () => ({
  useLocation: () => ({ search: mocks.search }),
  useNavigate: () => mocks.navigate,
}))
vi.mock('@/features/chat/hooks/useChatProfiles', () => ({
  useChatProfiles: () => ({ profiles: mocks.profiles, loading: false }),
}))
vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: (options: { onEvent: typeof mocks.onEvent }) => {
    mocks.onEvent = options.onEvent
    return { connected: true }
  },
}))
vi.mock('@/lib/api', () => ({
  apiFetch: (path: string, options?: { body?: Record<string, unknown> }) => {
    if (path === '/api/chat/archives') return mocks.readArchives()
    if (path.endsWith('/archive')) {
      return mocks
        .setArchive({ profileId: path.split('/')[3], ...options?.body })
        .then(() => mocks.archiveRows)
    }
    return mocks.apiFetch(path, options)
  },
}))
vi.mock('@/features/chat/cache', () => ({
  clearSharedChatResponses: () => Promise.resolve(),
  readSharedChatResponse: () => Promise.resolve(null),
  saveSharedChatResponse: () => Promise.resolve(),
  readInboxCache: () => Promise.resolve(null),
  readThreadCache: () => Promise.resolve(null),
  readPendingChatMessages: mocks.readPending,
  saveInboxCache: () => Promise.resolve(),
  saveThreadCache: () => Promise.resolve(),
  clearPendingChatMessage: mocks.clearPending,
  clearProfileChatCache: () => Promise.resolve(),
  clearThreadChatCache: () => Promise.resolve(),
  replacePendingChatMessage: () => Promise.resolve(),
  savePendingChatMessage: () => Promise.resolve(),
}))

let view: ReturnType<typeof mount> | undefined
let chat: ChatPageState

function Probe() {
  const state = useChatPage()
  useEffect(() => {
    chat = state
  }, [state])
  return (
    <output>
      {state.draft}:{state.conversation?.id ?? 'empty'}
    </output>
  )
}

function conversation(id: string): ChatThread {
  return {
    id,
    title: `Thread ${id}`,
    users: [],
    lastSeenAt: [],
    messages: Array.from({ length: 20 }, (_entry, index) => ({
      id: String(100 - index),
      senderId: 'other',
      text: String(index),
      timestamp: 100 - index,
      kind: 'text',
    })),
  }
}

beforeEach(() => {
  mocks.userId = 'user'
  mocks.search = '?profile=profile&thread=1'
  mocks.archiveRows = []
  mocks.readArchives.mockImplementation(async () => mocks.archiveRows)
  mocks.setArchive.mockImplementation(async ({ profileId, threadId, archived }) => {
    mocks.archiveRows = mocks.archiveRows.filter(
      (row) => row.profileId !== profileId || row.threadId !== threadId,
    )
    if (archived)
      mocks.archiveRows.push({ profileId: String(profileId), threadId: String(threadId) })
  })
  mocks.readPending.mockResolvedValue([])
  mocks.apiFetch.mockImplementation(async (path: string) => {
    if (path.endsWith('/session')) return { connected: true }
    if (path.endsWith('/threads')) return { viewerId: 'viewer', threads: [] }
    return conversation(path.split('/').at(-1) ?? '')
  })
})

afterEach(async () => {
  await view?.unmount()
  view = undefined
  vi.useRealTimers()
})

test.each([
  { scope: 'inbox', active: true, interval: 60_000, threshold: 60_000 },
  { scope: 'inbox', active: false, interval: 60_000, threshold: 180_000 },
  { scope: 'thread', active: true, interval: 30_000, threshold: 30_000 },
  { scope: 'thread', active: false, interval: 30_000, threshold: 120_000 },
])(
  '$scope polling tolerates clock drift (active: $active)',
  async ({ scope, active, interval, threshold }) => {
    vi.useFakeTimers()
    let now = Date.now()
    const startedAt = now
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const timers = vi.spyOn(globalThis, 'setInterval')
    view = mount()
    await view.render(<Probe />)
    const callback = timers.mock.calls.filter(([, delay]) => delay === interval).at(-1)?.[0]
    if (typeof callback !== 'function') throw new Error('Missing polling timer')
    const path = scope === 'inbox' ? '/api/chat/profile/threads' : '/api/chat/profile/threads/1'
    const polls = () => mocks.apiFetch.mock.calls.filter(([url]) => url === path).length
    const initialPolls = polls()
    now = startedAt + threshold - 101
    if (active) document.dispatchEvent(new Event('keydown'))
    await act(async () => {
      callback()
    })
    expect(polls()).toBe(initialPolls)

    now = startedAt + threshold - 1
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => {
      callback()
    })
    expect(polls()).toBe(initialPolls)
    visibility.mockRestore()
    mocks.apiFetch.mockImplementation(() => new Promise(() => {}))
    await act(async () => {
      callback()
    })
    expect(polls()).toBe(initialPolls + 1)

    now += threshold
    await act(async () => {
      callback()
    })
    expect(polls()).toBe(initialPolls + 1) // An outstanding request still blocks polling.
  },
)

test('thread changes immediately reset drafts, conversation, and older-message pagination', async () => {
  view = mount()
  await view.render(<Probe />)
  expect(chat.conversation?.id).toBe('1')
  expect(chat.conversation?.messages).toHaveLength(10)
  await act(async () => {
    chat.setDraft('private draft')
    await chat.loadOlder()
  })
  expect(chat.conversation?.messages).toHaveLength(20)
  const waiting: Array<(thread: ChatThread) => void> = []
  mocks.apiFetch.mockImplementation(
    () =>
      new Promise((resolve) => {
        waiting.push(resolve)
      }),
  )
  mocks.search = '?profile=profile&thread=2'
  await view.render(<Probe />)
  expect(chat.draft).toBe('')
  expect(chat.conversation).toBeNull()
  expect(chat.loadingThread).toBe(true)
  await act(async () => {
    waiting[0](conversation('2'))
  })
  expect(chat.conversation?.id).toBe('2')
  expect(chat.conversation?.messages).toHaveLength(10)
  expect(chat.loadingThread).toBe(false)
})

test('changing users clears private state and aborts outstanding requests', async () => {
  view = mount()
  await view.render(<Probe />)
  await act(async () => {
    chat.setDraft('private')
    chat.setCredentials('secret')
    chat.setConnectOpen(true)
  })
  const previousSignals = mocks.apiFetch.mock.calls.map(
    ([, options]) => options?.signal as AbortSignal,
  )
  mocks.apiFetch.mockImplementation(() => new Promise(() => {}))
  mocks.userId = 'other-user'
  await view.render(<Probe />)
  expect(chat.draft).toBe('')
  expect(chat.credentials).toBe('')
  expect(chat.connectOpen).toBe(false)
  expect(chat.inbox).toBeNull()
  expect(chat.conversation).toBeNull()
  expect(chat.connected).toBeNull()
  expect(previousSignals.every((signal) => signal.aborted)).toBe(true)
})

test('new messages preserve the number of previously visible messages', async () => {
  view = mount()
  await view.render(<Probe />)
  mocks.apiFetch.mockImplementation(async (path: string) => {
    if (path.endsWith('/threads')) return { viewerId: 'viewer', threads: [] }
    const thread = conversation('1')
    return {
      ...thread,
      messages: [
        { id: '101', senderId: 'other', text: 'new', timestamp: 101, kind: 'text' },
        ...thread.messages,
      ],
    }
  })
  await act(async () => {
    window.document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(chat.conversation?.messages).toHaveLength(11)
  expect(chat.conversation?.messages[0].id).toBe('101')
})

test('returning to a thread restarts loading and ignores the abandoned response', async () => {
  view = mount()
  await view.render(<Probe />)
  const requests: Array<{ resolve: (thread: ChatThread) => void; signal: AbortSignal }> = []
  mocks.apiFetch.mockImplementation(
    (_path: string, options: { signal: AbortSignal }) =>
      new Promise((resolve) => {
        requests.push({ resolve, signal: options.signal })
      }),
  )
  mocks.search = '?profile=profile&thread=2'
  await view.render(<Probe />)
  mocks.search = '?profile=profile&thread=1'
  await view.render(<Probe />)
  expect(chat.loadingThread).toBe(true)
  expect(chat.conversation).toBeNull()
  expect(requests[0].signal.aborted).toBe(true)
  await act(async () => {
    requests[0].resolve(conversation('2'))
  })
  expect(chat.conversation).toBeNull()
  await act(async () => {
    requests[1].resolve(conversation('1'))
  })
  expect(chat.conversation?.id).toBe('1')
  expect(chat.loadingThread).toBe(false)
})

test('confirmed replies leave persistent pending storage and do not appear twice', async () => {
  const pending = {
    id: 'local:pending',
    senderId: 'viewer',
    text: 'sent',
    timestamp: 201,
    kind: 'text',
    clientContext: 'pending',
    delivery: 'unconfirmed' as const,
  }
  mocks.readPending.mockResolvedValue([pending])
  mocks.apiFetch.mockImplementation(async (path: string) => {
    if (path.endsWith('/session')) return { connected: true }
    if (path.endsWith('/threads')) return { viewerId: 'viewer', threads: [] }
    const thread = conversation('1')
    return {
      ...thread,
      confirmedMessageIds: ['201'],
      messages: [{ ...pending, id: '201', delivery: undefined }, ...thread.messages],
    }
  })
  view = mount()
  await view.render(<Probe />)
  expect(mocks.clearPending).toHaveBeenCalledWith('user', 'profile', '1', 'local:pending')
  expect(
    chat.conversation?.messages.filter((message) => message.clientContext === 'pending'),
  ).toHaveLength(1)
  expect(chat.conversation?.messages.some((message) => message.delivery === 'unconfirmed')).toBe(
    false,
  )
})

test('folder and search filters combine with the profile while preserving chat selection', async () => {
  mocks.search = '?profile=profile&thread=1&folder=archived'
  mocks.archiveRows = [
    { profileId: 'profile', threadId: '1' },
    { profileId: 'other', threadId: '2' },
  ]
  mocks.apiFetch.mockImplementation(async (path: string) => {
    if (path.endsWith('/session')) return { connected: true }
    if (path.endsWith('/threads'))
      return { viewerId: 'viewer', threads: [conversation('1'), conversation('2')] }
    return conversation('1')
  })
  view = mount()
  await view.render(<Probe />)
  expect(chat.visibleThreads.map((thread) => thread.id)).toEqual(['1'])
  expect(chat.selectedArchived).toBe(true)
  await act(async () => chat.setSearchQuery('Thread 2'))
  expect(chat.visibleThreads).toEqual([])
  await act(async () => chat.setSearchQuery('Thread 1'))
  expect(chat.visibleThreads.map((thread) => thread.id)).toEqual(['1'])
  await act(async () => chat.selectFolder('inbox'))
  expect(mocks.navigate).toHaveBeenLastCalledWith('/chat?profile=profile&thread=1', {
    replace: true,
  })
  await act(async () => chat.selectThread('2'))
  expect(mocks.navigate).toHaveBeenLastCalledWith(
    '/chat?profile=profile&thread=2&folder=archived',
    { replace: true },
  )
  await act(async () => chat.selectProfile('all'))
  expect(mocks.navigate).toHaveBeenLastCalledWith('/chat?folder=archived', { replace: true })
})

test('Inbox is the default; archiving preserves the draft and new messages stay archived', async () => {
  let incoming = conversation('1')
  mocks.apiFetch.mockImplementation(async (path: string) => {
    if (path.endsWith('/session')) return { connected: true }
    if (path.endsWith('/threads'))
      return { viewerId: 'viewer', threads: [incoming, conversation('2')] }
    return incoming
  })
  view = mount()
  await view.render(<Probe />)
  expect(chat.folder).toBe('inbox')
  expect(chat.visibleThreads).toHaveLength(2)
  await act(async () => chat.setDraft('Unsent reply'))
  await act(async () => chat.changeArchive(true))
  expect(chat.visibleThreads.map((thread) => thread.id)).toEqual(['2'])
  expect(chat.selectedThreadId).toBe('1')
  expect(chat.draft).toBe('Unsent reply')
  incoming = {
    ...incoming,
    messages: [
      { ...incoming.messages[0], id: '501', text: 'New message', timestamp: Date.now() },
      ...incoming.messages,
    ],
  }
  await act(async () => mocks.onEvent?.({ type: 'chat_changed', profileId: 'profile' }))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300))
  })
  expect(chat.selectedArchived).toBe(true)
  expect(chat.conversation?.messages[0].text).toBe('New message')
  expect(chat.visibleThreads.map((thread) => thread.id)).toEqual(['2'])
  mocks.search = '?profile=profile&thread=1&folder=archived'
  await view.render(<Probe />)
  expect(chat.visibleThreads.map((thread) => thread.id)).toEqual(['1'])
  await act(async () => chat.changeArchive(false))
  expect(chat.selectedArchived).toBe(false)
  expect(chat.visibleThreads).toEqual([])
})

test('all-profile archive writes use the profile/thread pair with identical thread IDs', async () => {
  mocks.search = '?thread=profile%3A1'
  mocks.apiFetch.mockImplementation(async (path: string) => {
    if (path === '/api/chat/threads')
      return {
        errors: [],
        threads: [
          { ...conversation('1'), profileId: 'profile', profileName: 'Profile' },
          { ...conversation('1'), profileId: 'other', profileName: 'Other' },
        ],
      }
    return conversation('1')
  })
  view = mount()
  await view.render(<Probe />)
  await act(async () => chat.changeArchive(true))
  expect(mocks.setArchive).toHaveBeenLastCalledWith({
    profileId: 'profile',
    threadId: '1',
    archived: true,
  })
  expect(chat.visibleThreads.map((thread) => thread.profileId)).toEqual(['other'])
  expect(chat.selectedArchived).toBe(true)
  await act(async () => chat.changeArchive(false))
  expect(chat.visibleThreads).toHaveLength(2)
})

test.each([
  {
    search: '?profile=profile&thread=1',
    target: '2',
    profileId: 'profile',
    threadId: '2',
    selected: '1',
  },
  {
    search: '?thread=profile%3A1',
    target: 'other:1',
    profileId: 'other',
    threadId: '1',
    selected: 'profile:1',
  },
  { search: '?profile=profile', target: '2', profileId: 'profile', threadId: '2', selected: '' },
])(
  'archiving a list row preserves selection and draft: $search',
  async ({ search, target, profileId, threadId, selected }) => {
    mocks.search = search
    mocks.apiFetch.mockImplementation(async (path: string) => {
      if (path.endsWith('/session')) return { connected: true }
      if (path === '/api/chat/threads')
        return {
          errors: [],
          threads: [
            { ...conversation('1'), profileId: 'profile' },
            { ...conversation('1'), profileId: 'other' },
          ],
        }
      if (path.endsWith('/threads'))
        return { viewerId: 'viewer', threads: [conversation('1'), conversation('2')] }
      return conversation('1')
    })
    view = mount()
    await view.render(<Probe />)
    await act(async () => chat.setDraft('Unsent reply'))
    await act(async () => chat.changeArchive(true, target))
    expect(mocks.setArchive).toHaveBeenCalledExactlyOnceWith({
      profileId,
      threadId,
      archived: true,
    })
    expect(chat.selectedThreadId).toBe(selected)
    expect(chat.selectedArchived).toBe(false)
    expect(chat.draft).toBe('Unsent reply')
    expect(chat.visibleThreads).toHaveLength(1)
    expect(mocks.navigate).not.toHaveBeenCalled()
  },
)

test('archive notifications update other devices without reloading messages, and user changes hide metadata', async () => {
  mocks.archiveRows = [{ profileId: 'profile', threadId: '1' }]
  view = mount()
  await view.render(<Probe />)
  expect(chat.selectedArchived).toBe(true)
  const messageRequests = mocks.apiFetch.mock.calls.length
  mocks.archiveRows = [{ profileId: 'other', threadId: '2' }]
  await act(async () =>
    mocks.onEvent?.({ type: 'chat_changed', profileId: 'other', archivesChanged: true }),
  )
  expect(chat.selectedArchived).toBe(false)
  expect(mocks.apiFetch.mock.calls).toHaveLength(messageRequests)
  mocks.userId = ''
  await view.render(<Probe />)
  expect(chat.archivesLoading).toBe(true)
  expect(chat.selectedArchived).toBe(false)
})

test('failed saves preserve status and allow retry; duplicate clicks cannot submit concurrent saves', async () => {
  view = mount()
  await view.render(<Probe />)
  await act(async () => chat.setError('Previous error'))
  let rejectSave!: (error: Error) => void
  mocks.setArchive.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectSave = reject
      }),
  )
  let pending!: Promise<void>
  await act(async () => {
    pending = chat.changeArchive(true)
    void chat.changeArchive(true)
  })
  expect(mocks.setArchive).toHaveBeenCalledTimes(1)
  expect(chat.error).toBe('')
  expect(chat.savingArchive).toBe(true)
  expect(chat.selectedArchived).toBe(false)
  await act(async () => {
    rejectSave(new Error(JSON.stringify({ error: { message: 'Could not archive chat' } })))
    await pending
  })
  expect(chat.error).toBe('Could not archive chat')
  expect(chat.selectedArchived).toBe(false)
  expect(chat.savingArchive).toBe(false)
  await act(async () => chat.changeArchive(true))
  expect(chat.error).toBe('')
  expect(chat.selectedArchived).toBe(true)
})

test('a stale metadata read cannot overwrite a completed archive save', async () => {
  view = mount()
  await view.render(<Probe />)
  let resolveRead!: (rows: { profileId: string; threadId: string }[]) => void
  mocks.readArchives.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRead = resolve
      }),
  )
  await act(async () => mocks.onEvent?.({ type: 'chat_changed', archivesChanged: true }))
  await act(async () => chat.changeArchive(true))
  expect(chat.selectedArchived).toBe(true)
  await act(async () => resolveRead([]))
  expect(chat.selectedArchived).toBe(true)
})

test('late archive saves do not expose the previous user metadata', async () => {
  view = mount()
  await view.render(<Probe />)
  let resolveSave!: () => void
  mocks.setArchive.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveSave = resolve
      }),
  )
  let pending!: Promise<void>
  await act(async () => {
    pending = chat.changeArchive(true)
  })
  mocks.userId = 'another-user'
  await view.render(<Probe />)
  // The old request returns its old-user catalog, then the new user gets a fresh read.
  mocks.archiveRows = [{ profileId: 'profile', threadId: '1' }]
  mocks.readArchives.mockResolvedValue([])
  await act(async () => {
    resolveSave()
    await pending
  })
  expect(chat.selectedArchived).toBe(false)
})
