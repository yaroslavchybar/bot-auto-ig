import * as React from 'react'
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

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  activeId: NavId
  onNavigate: (id: NavId) => void
}

export function AppSidebar({
  activeId,
  onNavigate,
  ...props
}: AppSidebarProps) {
  const navMain = [
    {
      title: 'Platform',
      items: [
        {
          title: 'Profiles Manager',
          id: 'profiles',
          icon: Users,
        },
        {
          title: 'Workflows',
          id: 'workflows',
          icon: GitBranch,
        },
        {
          title: 'Scraping',
          id: 'scraping',
          icon: Search,
        },
        {
          title: 'Lists Manager',
          id: 'lists',
          icon: List,
        },
        {
          title: 'Upload Accounts',
          id: 'accounts',
          icon: Upload,
        },
        {
          title: 'Browser View',
          id: 'vnc',
          icon: Monitor,
        },
        {
          title: 'Logs',
          id: 'logs',
          icon: FileText,
        },
        {
          title: 'VPS Monitor',
          id: 'monitoring',
          icon: Activity,
        },
      ],
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
            <SidebarMenuButton
              size="lg"
              onClick={() => onNavigate('profiles')}
              className="hover:bg-panel-subtle"
            >
              <div className="brand-avatar flex aspect-square size-8 items-center justify-center rounded-lg">
                <Command className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="text-ink truncate font-semibold">Anti</span>
                <span className="text-subtle-copy truncate text-xs">
                  Automation Platform
                </span>
              </div>
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
                      isActive={activeId === item.id}
                      onClick={() => onNavigate(item.id as NavId)}
                      tooltip={item.title}
                      className="text-muted-copy hover:text-ink hover:bg-panel-subtle data-[active=true]:bg-panel-selected transition-colors data-[active=true]:text-white"
                    >
                      {item.icon && <item.icon />}
                      <span>{item.title}</span>
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
