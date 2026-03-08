import * as React from "react"
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
} from "lucide-react"

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
} from "@/components/ui/sidebar"

export const NAV_IDS = ['profiles', 'workflows', 'scraping', 'lists', 'accounts', 'logs', 'vnc', 'monitoring'] as const

export type NavId = (typeof NAV_IDS)[number];

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  activeId: NavId;
  onNavigate: (id: NavId) => void;
}

export function AppSidebar({ activeId, onNavigate, ...props }: AppSidebarProps) {
  const navMain = [
    {
      title: "Platform",
      items: [
        {
          title: "Profiles Manager",
          id: "profiles",
          icon: Users,
        },
        {
          title: "Workflows",
          id: "workflows",
          icon: GitBranch,
        },
        {
          title: "Scraping",
          id: "scraping",
          icon: Search,
        },
        {
          title: "Lists Manager",
          id: "lists",
          icon: List,
        },
        {
          title: "Upload Accounts",
          id: "accounts",
          icon: Upload,
        },
        {
          title: "Browser View",
          id: "vnc",
          icon: Monitor,
        },
        {
          title: "Logs",
          id: "logs",
          icon: FileText,
        },
        {
          title: "VPS Monitor",
          id: "monitoring",
          icon: Activity,
        },
      ],
    },
  ] as const

  return (
    <Sidebar collapsible="icon" className="border-r border-white/5" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" onClick={() => onNavigate('profiles')} className="hover:bg-white/[0.02]">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-gradient-to-br from-red-600 to-orange-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)]">
                <Command className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold text-gray-200">Anti</span>
                <span className="truncate text-xs text-gray-500">Automation Platform</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {navMain.map((group) => (
          <SidebarGroup key={group.title}>
            <SidebarGroupLabel className="text-gray-400/80 uppercase tracking-widest text-[10px]">{group.title}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={activeId === item.id}
                      onClick={() => onNavigate(item.id as NavId)}
                      tooltip={item.title}
                      className="text-gray-400 hover:text-gray-200 hover:bg-white/[0.02] data-[active=true]:bg-white/[0.04] data-[active=true]:text-white transition-colors"
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
