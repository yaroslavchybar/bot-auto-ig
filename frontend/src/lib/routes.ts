import { ListsPage } from '@/features/lists/ListsPage'
import { ProfilesPage } from '@/features/profiles/ProfilesPage'
import { ProxiesPage } from '@/features/proxies/ProxiesPage'
import { VncPage } from '@/features/vnc/VncPage'
import { VncSessionPage } from '@/features/vnc/VncSessionPage'
import { ScraperPage } from '@/features/scraper/ScraperPage'
import { AutomationsPage } from '@/features/automations/AutomationsPage'
import { LoginPage } from '@/pages/LoginPage'
import { ChatPage } from '@/features/chat/ChatPage'
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
  '/lists': { Page: ListsPage, breadcrumb: 'Lists Manager', navId: 'lists' },
  '/proxies': { Page: ProxiesPage, breadcrumb: 'Proxies', navId: 'proxies' },
  '/vnc': { Page: VncPage, breadcrumb: 'Browser View', navId: 'vnc' },
  '/vnc/session/:automationId/:profileName': { Page: VncSessionPage,
    breadcrumb: 'Live Session',
    navId: 'vnc',
  },
  '/login': { Page: LoginPage, breadcrumb: 'Sign In' },
}

