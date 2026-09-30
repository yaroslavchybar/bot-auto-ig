import { lazy } from 'react'
const ListsPage = lazy(() =>
  import('@/features/lists/ListsPage').then((module) => ({ default: module.ListsPage })),
)
const ProfilesPage = lazy(() =>
  import('@/features/profiles/ProfilesPage').then((module) => ({ default: module.ProfilesPage })),
)
const ProxiesPage = lazy(() =>
  import('@/features/proxies/ProxiesPage').then((module) => ({ default: module.ProxiesPage })),
)
const VncPage = lazy(() =>
  import('@/features/vnc/VncPage').then((module) => ({ default: module.VncPage })),
)
const VncSessionPage = lazy(() =>
  import('@/features/vnc/VncSessionPage').then((module) => ({ default: module.VncSessionPage })),
)
const ScraperPage = lazy(() =>
  import('@/features/scraper/ScraperPage').then((module) => ({ default: module.ScraperPage })),
)
const AutomationsPage = lazy(() =>
  import('@/features/automations/AutomationsPage').then((module) => ({
    default: module.AutomationsPage,
  })),
)
const LoginPage = lazy(() =>
  import('@/pages/LoginPage').then((module) => ({ default: module.LoginPage })),
)
const ChatPage = lazy(() =>
  import('@/features/chat/ChatPage').then((module) => ({ default: module.ChatPage })),
)
const IgAccountsPage = lazy(() =>
  import('@/features/ig-accounts/IgAccountsPage').then((module) => ({
    default: module.IgAccountsPage,
  })),
)
import type { NavId } from '@/components/layout/app-sidebar'

// Keep page imports outside the router: pages also import its hooks.
export type RouteMeta = {
  Page: React.ComponentType
  breadcrumb: string
  navId?: NavId
  appChrome?: 'default' | 'immersive'
}

export const ROUTE_META: Record<string, RouteMeta> = {
  '/profiles': { Page: ProfilesPage, breadcrumb: 'Profiles Manager', navId: 'profiles' },
  '/automations': { Page: AutomationsPage, breadcrumb: 'Automations', navId: 'automations' },
  '/scraper': { Page: ScraperPage, breadcrumb: 'Scraper', navId: 'scraper' },
  '/chat': { Page: ChatPage, breadcrumb: 'Chat', navId: 'chat' },
  '/ig-accounts': { Page: IgAccountsPage, breadcrumb: 'IG Accounts', navId: 'ig_accounts' },
  '/lists': { Page: ListsPage, breadcrumb: 'Models', navId: 'lists' },
  '/proxies': { Page: ProxiesPage, breadcrumb: 'Proxies', navId: 'proxies' },
  '/vnc': { Page: VncPage, breadcrumb: 'Browser View', navId: 'vnc' },
  '/vnc/session/:automationId/:profileName': {
    Page: VncSessionPage,
    breadcrumb: 'Live Session',
    navId: 'vnc',
  },
  '/login': { Page: LoginPage, breadcrumb: 'Sign In' },
}
