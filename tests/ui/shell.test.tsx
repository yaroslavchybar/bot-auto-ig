import { afterEach, expect, test, vi } from 'vite-plus/test'
import { ProtectedLayoutShell } from '@/components/layout/ProtectedLayoutShell'
import { mount } from './mount'

vi.mock('@/components/layout/ConvexClientProvider', () => ({
  ConvexClientProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('@/components/layout/app-sidebar', () => ({
  AppSidebar: () => <aside>Shared shell</aside>,
}))
vi.mock('@/components/layout/user-menu', () => ({ UserMenu: () => null }))
vi.mock('@/components/layout/theme-toggle', () => ({ ThemeToggle: () => null }))
vi.mock('@/features/vnc/hooks/useVncSessions', () => ({
  VncSessionsProvider: ({ children }: { children: React.ReactNode }) => children,
  useVncSessions: () => ({ sessions: [] }),
}))
vi.mock('@/lib/router', () => ({ useLocation: () => ({ search: '' }), useNavigate: () => vi.fn() }))
let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
})

test('page changes including Browser View reuse the same shell DOM', async () => {
  view = mount()
  const Page = () => null
  await view.render(
    <ProtectedLayoutShell pathname="/profiles" routeMeta={{ Page, breadcrumb: 'Profiles' }}>
      <p>Profiles page</p>
    </ProtectedLayoutShell>,
  )
  const sidebar = view.container.querySelector('aside')
  const header = view.container.querySelector('header')
  await view.render(
    <ProtectedLayoutShell pathname="/vnc" routeMeta={{ Page, breadcrumb: 'Browser View' }}>
      <p>Browser page</p>
    </ProtectedLayoutShell>,
  )
  expect(view.container.querySelector('aside')).toBe(sidebar)
  expect(view.container.querySelector('header')).toBe(header)
  await view.render(
    <ProtectedLayoutShell pathname="/proxies" routeMeta={{ Page, breadcrumb: 'Proxies' }}>
      <p>Proxies page</p>
    </ProtectedLayoutShell>,
  )
  expect(view.container.querySelector('aside')).toBe(sidebar)
  expect(view.container.textContent).not.toContain('Browser page')
})
