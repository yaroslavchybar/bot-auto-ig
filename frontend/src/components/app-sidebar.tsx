import * as React from "react"
import {
  LayoutDashboard,
  Users,
  Search,
  List,
  FileText,
  Command,
  Upload,
  GitBranch,
  Monitor,
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

export type NavId = 'dashboard' | 'profiles' | 'workflows' | 'scraping' | 'lists' | 'accounts' | 'logs' | 'vnc';

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
          title: "Dashboard",
          id: "dashboard",
          icon: LayoutDashboard,
        },
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
      ],
    },
  ] as const

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" onClick={() => onNavigate('dashboard')}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <Command className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">Anti</span>
                <span className="truncate text-xs">Automation Platform</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {navMain.map((group) => (
          <SidebarGroup key={group.title}>
            <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={activeId === item.id}
                      onClick={() => onNavigate(item.id as NavId)}
                      tooltip={item.title}
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
