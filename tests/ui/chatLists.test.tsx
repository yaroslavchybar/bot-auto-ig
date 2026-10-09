import { useEffect } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { useChatLists } from '@/features/chat/hooks/useChatLists'
import type { ChatThread } from '@/features/chat/types'
import { mount } from './mount'

const mocks = vi.hoisted(() => ({
  queries: {} as Record<
    string,
    { args: { contacts: { profileId: string; igId: string; username: string }[] } }
  >,
  pending: false,
}))
vi.mock('convex/react', () => ({
  useQuery: () => [{ _id: 'purpose', name: 'Purpose' }],
  useQueries: (queries: typeof mocks.queries) => {
    mocks.queries = queries
    return Object.fromEntries(
      Object.entries(queries).map(([key, query]) => [
        key,
        mocks.pending
          ? undefined
          : query.args.contacts.map((contact) => ({ ...contact, listIds: ['purpose'] })),
      ]),
    )
  },
}))

let state: ReturnType<typeof useChatLists>
let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
  mocks.pending = false
})
function Probe({ threads }: { threads: ChatThread[] }) {
  const value = useChatLists(threads, 'profile', 'viewer')
  useEffect(() => {
    state = value
  }, [value])
  return null
}
function thread(id: string, users: ChatThread['users'], profileId?: string): ChatThread {
  return { id, users, profileId, title: 'Chat', messages: [], lastSeenAt: [] }
}

test('subscriptions deduplicate recipients, exclude viewers, and keep group/profile membership distinct', async () => {
  const users = [
    { id: 'viewer', username: 'self' },
    { id: '123', username: 'recipient' },
  ]
  view = mount()
  await view.render(
    <Probe threads={[thread('1', users), thread('2', users), thread('1', users, 'other')]} />,
  )
  expect(mocks.queries['0'].args.contacts).toEqual([
    { profileId: 'other', igId: '123', username: 'recipient' },
    { profileId: 'profile', igId: '123', username: 'recipient' },
  ])
  expect([...state.threadLists.get('profile:1')!]).toEqual(['purpose'])
  expect([...state.threadLists.get('other:1')!]).toEqual(['purpose'])
  await view.render(<Probe threads={[thread('3', [])]} />)
  expect(mocks.queries).toEqual({})
  expect(state.loading).toBe(false)
})

test('large inboxes use bounded contact subscriptions and wait for metadata', async () => {
  const threads = Array.from({ length: 2001 }, (_, index) =>
    thread(String(index), [{ id: String(index), username: `user${index}` }]),
  )
  view = mount()
  mocks.pending = true
  await view.render(<Probe threads={threads} />)
  expect(Object.values(mocks.queries)).toHaveLength(11)
  expect(Object.values(mocks.queries).every((query) => query.args.contacts.length <= 200)).toBe(
    true,
  )
  expect(state.loading).toBe(true)
  mocks.pending = false
  await view.render(<Probe threads={threads} />)
  expect(state.loading).toBe(false)
  expect([...state.threadLists.get('profile:2000')!]).toEqual(['purpose'])
})
