import * as React from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { Link, useLocation } from '@/lib/router'
import {
  Users,
  List,
  GitBranch,
  Monitor,
  Globe,
  MessageSquare,
} from 'lucide-react'

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'

export const NAV_IDS = [
  'profiles',
  'automations',
  'scraper',
  'lists',
  'proxies',
  'vnc',
  'chat',
] as const

export type NavId = (typeof NAV_IDS)[number]

export const NAV_ITEMS = [
  {
    title: 'Profiles Manager',
    id: 'profiles',
    to: '/profiles',
    icon: Users,
    breadcrumb: 'Profiles Manager',
  },
  {
    title: 'Automations',
    id: 'automations',
    to: '/automations',
    icon: GitBranch,
    breadcrumb: 'Automations',
  },
  {
    title: 'Lists Manager',
    id: 'lists',
    to: '/lists',
    icon: List,
    breadcrumb: 'Lists Manager',
  },
  { title: 'Scraper', id: 'scraper', to: '/scraper', icon: Users, breadcrumb: 'Scraper' },
  { title: 'Chat', id: 'chat', to: '/chat', icon: MessageSquare, breadcrumb: 'Chat' },
  {
    title: 'Proxies',
    id: 'proxies',
    to: '/proxies',
    icon: Globe,
    breadcrumb: 'Proxies',
  },
  {
    title: 'Browser View',
    id: 'vnc',
    to: '/vnc',
    icon: Monitor,
    breadcrumb: 'Browser View',
  },
] as const satisfies ReadonlyArray<{
  title: string
  id: NavId
  to: string
  icon: React.ComponentType<{ className?: string }>
  breadcrumb: string
}>

type AppSidebarProps = React.ComponentProps<typeof Sidebar>

export function AppSidebar(props: AppSidebarProps) {
  const { pathname } = useLocation()
  const unreadChats = useQuery(api.chatCache.unreadCount, {}) ?? 0
  const navMain = [
    {
      title: 'Platform',
      items: NAV_ITEMS,
    },
  ] as const

  return (
    <Sidebar
      collapsible="icon"
      className="border-line-soft border-r"
      {...props}
    >
      <SidebarHeader>
        <div className="flex items-center justify-start px-1 group-data-[collapsible=icon]:justify-center">
          <SidebarTrigger className="text-muted-copy hover:text-ink size-8" />
        </div>
      </SidebarHeader>
      <SidebarContent>
        {navMain.map((group) => (
          <SidebarGroup key={group.title}>
            <SidebarGroupLabel className="text-muted-copy/80 text-[10px] tracking-widest uppercase">
              {group.title}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={
                        pathname === item.to || pathname.startsWith(`${item.to}/`)
                      }
                      className="text-muted-copy hover:text-ink hover:bg-panel-subtle data-[active=true]:bg-panel-selected transition-colors data-[active=true]:text-ink"
                    >
                      <Link to={item.to}>
                        {item.icon && <item.icon />}
                        <span>{item.title}</span>
                        {item.id === 'chat' && unreadChats > 0 && (
                          <span className="ml-auto rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground"
                            aria-label={`${unreadChats} conversations awaiting reply`}>
                            {unreadChats}
                          </span>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}


