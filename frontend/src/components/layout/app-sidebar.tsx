import * as React from 'react'
import { NavLink, useLocation } from 'react-router'
import {
  Users,
  Search,
  List,
  FileText,
  Command,
  Upload,
  GitBranch,
  Monitor,
  Activity,
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
} from '@/components/ui/sidebar'

export const NAV_IDS = [
  'profiles',
  'workflows',
  'scraping',
  'lists',
  'accounts',
  'logs',
  'vnc',
  'monitoring',
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
    title: 'Workflows',
    id: 'workflows',
    to: '/workflows',
    icon: GitBranch,
    breadcrumb: 'Workflows',
  },
  {
    title: 'Scraping',
    id: 'scraping',
    to: '/scraping',
    icon: Search,
    breadcrumb: 'Scraping',
  },
  {
    title: 'Lists Manager',
    id: 'lists',
    to: '/lists',
    icon: List,
    breadcrumb: 'Lists Manager',
  },
  {
    title: 'Upload Accounts',
    id: 'accounts',
    to: '/accounts',
    icon: Upload,
    breadcrumb: 'Upload Accounts',
  },
  {
    title: 'Browser View',
    id: 'vnc',
    to: '/vnc',
    icon: Monitor,
    breadcrumb: 'Browser View',
  },
  {
    title: 'Logs',
    id: 'logs',
    to: '/logs',
    icon: FileText,
    breadcrumb: 'Logs',
  },
  {
    title: 'VPS Monitor',
    id: 'monitoring',
    to: '/monitoring',
    icon: Activity,
    breadcrumb: 'VPS Monitor',
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
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" className="hover:bg-panel-subtle">
              <NavLink to="/profiles">
                <div className="brand-avatar flex aspect-square size-8 items-center justify-center rounded-lg">
                  <Command className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="text-ink truncate font-semibold">Anti</span>
                  <span className="text-subtle-copy truncate text-xs">
                    Automation Platform
                  </span>
                </div>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
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
                      <NavLink to={item.to}>
                        {item.icon && <item.icon />}
                        <span>{item.title}</span>
                      </NavLink>
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


