import type { ReactNode } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { IgAccountsPage } from '@/features/ig-accounts/IgAccountsPage'
import { apiFetch } from '@/lib/api'
import { mount } from './mount'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))
vi.mock('@/lib/router', () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams({ profileId: 'owner' })],
}))
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: ReactNode }) => children,
  SelectTrigger: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="credential-options">{children}</div>
  ),
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <div role="option" data-value={value}>
      {children}
    </div>
  ),
}))

let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
})

test('connect options exclude assigned, connected, and invalid credentials, including the profile own credentials', async () => {
  vi.mocked(apiFetch).mockResolvedValue({
    page: [
      { id: 'free', username: 'free', status: 'available' },
      { id: 'assigned', username: 'assigned', status: 'assigned', profileId: 'owner' },
      { id: 'connected', username: 'connected', status: 'connected', profileId: 'owner' },
      { id: 'invalid', username: 'invalid', status: 'invalid', profileId: 'owner' },
    ],
    continueCursor: 'next',
    isDone: false,
  })
  view = mount()
  await view.render(<IgAccountsPage />)
  const dialog = document.querySelector('[role="dialog"]')!
  expect(
    [...dialog.querySelectorAll('[role="option"]')].map((option) =>
      option.getAttribute('data-value'),
    ),
  ).toEqual(['free'])
  expect(dialog.querySelector<HTMLButtonElement>('[aria-label="Next page"]')?.disabled).toBe(false)
  expect(apiFetch).toHaveBeenCalledWith(
    '/api/ig-accounts/page?search=&profileId=owner',
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  )
})
