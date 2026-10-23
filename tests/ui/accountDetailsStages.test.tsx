import { afterEach, expect, test, vi } from 'vite-plus/test'
import { AccountDetailsDialog } from '@/features/ig-accounts/components/AccountDetailsDialog'
import { mount } from './mount'

const state = vi.hoisted(() => ({ pending: undefined as string | undefined }))
vi.mock('@/lib/api', () => ({
  apiFetch: async (path: string) =>
    path.includes('/credentials/')
      ? {
          id: 'account',
          username: 'alice',
          password: 'fixture',
          authenticatorKey: 'fixture',
          profileId: 'profile',
          status: 'connected',
          createdAt: 0,
          browserLoggedInAt: 1,
        }
      : [
          {
            profileId: 'profile',
            modelId: 'model',
            startedAt: 1,
            postSourceIds: [],
            postDates: [],
            pending: state.pending ? { kind: state.pending, date: '2026-10-23' } : undefined,
          },
        ],
}))
let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
})

test.each([
  ['username', 'Username change'],
  ['fullName', 'Full name'],
  ['avatar', 'Avatar (day 4+)'],
  ['post', 'Feed posts'],
])('pending %s highlights its own stage', async (kind, label) => {
  state.pending = kind
  view = mount()
  await view.render(
    <AccountDetailsDialog
      account={{ id: 'account', username: 'alice', status: 'connected', profileId: 'profile' }}
      onClose={() => {}}
    />,
  )
  const highlighted = [...document.querySelectorAll('li')].filter((row) =>
    row.querySelector('svg.text-status-warning'),
  )
  expect(highlighted).toHaveLength(1)
  expect(highlighted[0].textContent).toContain(label)
})

test('without a pending action the first incomplete stage remains current', async () => {
  state.pending = undefined
  view = mount()
  await view.render(
    <AccountDetailsDialog
      account={{ id: 'account', username: 'alice', status: 'connected', profileId: 'profile' }}
      onClose={() => {}}
    />,
  )
  expect(document.body.textContent).toContain('now: username change')
  expect(document.querySelector('li svg.text-status-warning')).toBeNull()
})
