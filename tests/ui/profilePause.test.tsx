import { act, type ReactNode } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { ProfilesList } from '@/features/profiles/components/ProfilesList'
import { mount } from './mount'

const mocks = vi.hoisted(() => ({ pause: vi.fn(), mobile: false }))
vi.mock('convex/react', () => ({ useMutation: () => mocks.pause }))
vi.mock('@/lib/router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mocks.mobile }))
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode
    onClick: () => void
    disabled: boolean
  }) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  DropdownMenuSeparator: () => <hr />,
}))

let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
  mocks.pause.mockReset()
})

test.each([false, true])('profile unread chat badges show known counts and unknown state on mobile=%s', async mobile => {
  mocks.mobile = mobile
  view = mount()
  await view.render(<ProfilesList profiles={[
    { id: 'unread', name: 'Unread', unreadChatCount: 8, unreadChatsCheckedAt: 100 },
    { id: 'read', name: 'Read', unreadChatCount: 0, unreadChatsCheckedAt: 200 },
    { id: 'unknown', name: 'Unknown' },
  ]} loading={false} onEdit={() => {}} onDelete={() => {}} onToggleStatus={() => {}} onDetails={() => {}} />)
  expect(view.container.querySelector('[aria-label="8 unread chats"]')?.textContent).toBe('8')
  expect(view.container.querySelector('[aria-label="0 unread chats"]')?.textContent).toBe('0')
  expect(view.container.querySelector('[aria-label="Unread chats not checked yet"]')?.textContent).toBe('—')
  expect(view.container.querySelector('[aria-label="8 unread chats"]')?.getAttribute('title')).toContain('Checked')
})

test.each([false, true])('the profile details icon opens the selected profile on mobile=%s', async mobile => {
  mocks.mobile = mobile
  const onDetails = vi.fn()
  const profile = { id: 'profile', name: 'Example' }
  view = mount()
  await view.render(<ProfilesList profiles={[profile]} loading={false} onEdit={() => {}} onDelete={() => {}}
    onToggleStatus={() => {}} onDetails={onDetails} />)
  const icon = view.container.querySelector<HTMLButtonElement>('[aria-label="View Example details"]')!
  expect(icon.closest('[class*="opacity-0"]')).toBeNull()
  await act(async () => icon.click())
  expect(onDetails).toHaveBeenCalledWith(profile)
})

test.each([false, true])('profile icons show errors, pending review and login status on mobile=%s', async mobile => {
  mocks.mobile = mobile
  view = mount()
  await view.render(<ProfilesList profiles={[
    { id: 'error', name: 'Error', attention: 'error', igLoggedIn: true },
    { id: 'review', name: 'Review', attention: 'review' },
    { id: 'normal', name: 'Normal' },
  ]} loading={false} onEdit={() => {}} onDelete={() => {}} onToggleStatus={() => {}} onDetails={() => {}} />)
  const icon = (name: string) => view!.container.querySelector(`[aria-label^="View ${name} details"]`)!
  expect(icon('Error').classList.contains('text-status-danger')).toBe(true)
  expect(icon('Error').getAttribute('title')).toContain('Error')
  expect(icon('Error').getAttribute('aria-label')).toBe('View Error details — Error')
  expect(icon('Review').classList.contains('text-status-warning')).toBe(true)
  expect(icon('Review').getAttribute('title')).toContain('needs review')
  expect(icon('Review').getAttribute('aria-label')).toBe('View Review details — Action needs review')
  expect(icon('Normal').classList.contains('text-muted-copy')).toBe(true)
  expect(icon('Normal').getAttribute('aria-label')).toBe('View Normal details')
  expect(view.container.querySelector('[role="switch"]')).toBeNull()
  expect(view.container.querySelector('[role="img"][aria-label="Logged in"]')).not.toBeNull()
  expect(view.container.querySelectorAll('[role="img"][aria-label="Not logged in"]')).toHaveLength(2)
})

test.each([false, true])(
  'profile menus pause and resume on mobile=%s with a visible paused status',
  async (mobile) => {
    mocks.mobile = mobile
    mocks.pause.mockResolvedValue(undefined)
    view = mount()
    const profile = { id: 'profile', name: 'Model', inUse: false, paused: false }
    const render = (paused: boolean) =>
      view!.render(
        <ProfilesList
          profiles={[{ ...profile, paused }]}
          loading={false}
          onEdit={() => {}}
          onDelete={() => {}}
          onToggleStatus={() => {}}
          onDetails={() => {}}
        />,
      )
    const button = (label: string) =>
      [...view!.container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!
    await render(false)
    await act(async () => button('Pause Profile').click())
    expect(mocks.pause).toHaveBeenLastCalledWith({ profileId: 'profile', paused: true })
    await render(true)
    expect(view.container.textContent).toMatch(/Paused|PAUSED/)
    expect(button('Pause Profile')).toBeUndefined()
    await act(async () => button('Resume Profile').click())
    expect(mocks.pause).toHaveBeenLastCalledWith({ profileId: 'profile', paused: false })
  },
)
