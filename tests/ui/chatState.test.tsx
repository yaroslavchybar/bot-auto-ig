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
  clearPending: vi.fn(() => Promise.resolve()),
  readPending: vi.fn<() => Promise<ChatMessage[]>>(() => Promise.resolve([])),
  profiles: [{ id: 'profile', name: 'Profile', igLoggedIn: true, status: 'idle' }],
}))

vi.mock('@/lib/auth', () => ({ useAppUser: () => ({ id: mocks.userId }) }))
vi.mock('@/lib/router', () => ({
  useLocation: () => ({ search: mocks.search }),
  useNavigate: () => mocks.navigate,
}))
vi.mock('@/features/profiles/hooks/useProfiles', () => ({
  useProfiles: () => ({ profiles: mocks.profiles, loading: false }),
}))
vi.mock('@/lib/api', () => ({ apiFetch: mocks.apiFetch }))
vi.mock('@/features/chat/cache', () => ({
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
})

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
