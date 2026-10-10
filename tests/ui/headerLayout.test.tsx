import type { ReactNode } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { ProtectedLayoutShell } from '@/components/layout/ProtectedLayoutShell'
import { mount } from './mount'

vi.mock('@/components/layout/ConvexClientProvider', () => ({
  ConvexClientProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/components/layout/app-sidebar', () => ({ AppSidebar: () => null }))
vi.mock('@/components/layout/user-menu', () => ({ UserMenu: () => null }))
vi.mock('@/components/layout/theme-toggle', () => ({ ThemeToggle: () => null }))
vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  SidebarTrigger: () => null,
}))
vi.mock('@/features/vnc/hooks/useVncSessions', () => ({
  VncSessionsProvider: ({ children }: { children: ReactNode }) => children,
  useVncSessions: () => ({ sessions: [] }),
}))
vi.mock('@/lib/router', () => ({
  useLocation: () => ({ search: '' }),
  useNavigate: () => vi.fn(),
}))

let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
})

test.each([
  ['profiles', 'profiles-header-slot'],
  ['ig-accounts', 'ig-accounts-header-slot'],
  ['proxies', 'proxies-header-slot'],
  ['scraper', 'scraper-header-slot'],
  ['automations', 'automations-header-slot'],
  ['chat', 'chat-header-slot'],
])('header for /%s/ retains its slot and section navigation', async (page, id) => {
  view = mount()
  await view.render(
    <ProtectedLayoutShell pathname={`/${page}/`} routeMeta={{ breadcrumb: page, Page: () => null }}>
      <p>Page content</p>
    </ProtectedLayoutShell>,
  )
  expect(view.container.querySelector(`#${id}`)).not.toBeNull()
  if (page === 'scraper' || page === 'proxies') {
    expect(view.container.querySelector('nav[aria-label$="sections"]')?.textContent).toContain(
      page === 'scraper' ? 'Sources' : 'Blacklist',
    )
  }
})
