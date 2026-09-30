import { act } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { AccountsList } from '@/features/ig-accounts/components/AccountsList'
import { IgAccountsPage } from '@/features/ig-accounts/IgAccountsPage'
import { apiFetch } from '@/lib/api'
import { mount } from './mount'

const mobile = vi.hoisted(() => ({ value: false }))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mobile.value }))
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))
vi.mock('@/lib/router', () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams()],
}))
let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
  mobile.value = false
  vi.clearAllMocks()
})

test('only incompatible sessions offer reconnect and button does not open account details', async () => {
  const onSelect = vi.fn(),
    onReconnect = vi.fn()
  const old = {
    id: 'old',
    username: 'old',
    status: 'connected' as const,
    profileId: 'profile',
    reconnectRequired: true,
  }
  const current = {
    id: 'current',
    username: 'current',
    status: 'connected' as const,
    reconnectRequired: false,
  }
  view = mount()
  await view.render(
    <AccountsList
      accounts={[old, current]}
      loading={false}
      onSelect={onSelect}
      onReconnect={onReconnect}
    />,
  )
  expect(view.container.textContent).toContain('Reconnect needed')
  const buttons = [...view.container.querySelectorAll<HTMLButtonElement>('button')]
  expect(buttons).toHaveLength(1)
  await act(async () => buttons[0].click())
  expect(onReconnect).toHaveBeenCalledWith(old)
  expect(onSelect).not.toHaveBeenCalled()
  await view.render(
    <AccountsList
      accounts={[old, current]}
      loading={false}
      onReconnect={onReconnect}
      reconnectingId="old"
    />,
  )
  const busy = view.container.querySelector<HTMLButtonElement>('button')!
  expect(busy.disabled).toBe(true)
  expect(busy.textContent).toContain('Reconnecting...')
})

test('mobile cards expose the same reconnect action', async () => {
  mobile.value = true
  const onReconnect = vi.fn()
  view = mount()
  await view.render(
    <AccountsList
      accounts={[{ id: 'old', username: 'old', status: 'connected', reconnectRequired: true }]}
      loading={false}
      onReconnect={onReconnect}
    />,
  )
  expect(view.container.textContent).toContain('Reconnect needed')
  await act(async () => view!.container.querySelector<HTMLButtonElement>('button')!.click())
  expect(onReconnect).toHaveBeenCalledOnce()
})

test('account reconnect shows errors, allows retry, and refreshes to Connected after success', async () => {
  let needsReconnect = true,
    fail = true
  vi.mocked(apiFetch).mockImplementation(async (path) => {
    if (path === '/api/ig-accounts/profile/connect') {
      if (fail) throw new Error('Instagram requires verification')
      needsReconnect = false
      return { ok: true }
    }
    return {
      page: [
        {
          id: 'old',
          username: 'old',
          status: 'connected',
          profileId: 'profile',
          reconnectRequired: needsReconnect,
        },
      ],
      isDone: true,
      continueCursor: '',
    }
  })
  view = mount()
  await view.render(<IgAccountsPage />)
  const reconnect = () =>
    [...view!.container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Reconnect'),
    )!
  await act(async () => reconnect().click())
  expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(
    'Instagram requires verification',
  )
  expect(reconnect().disabled).toBe(false)
  fail = false
  await act(async () => reconnect().click())
  expect(apiFetch).toHaveBeenCalledWith('/api/ig-accounts/profile/connect', {
    method: 'POST',
    body: { credentialId: 'old' },
    timeout: 360_000,
  })
  expect(view.container.textContent).not.toContain('Reconnect needed')
  expect(view.container.textContent).toContain('Connected')
  expect(view.container.textContent).toContain('@old reconnected.')
})
