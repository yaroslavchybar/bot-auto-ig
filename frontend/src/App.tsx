import { useState, useEffect } from 'react'
import { ProfilesPage } from './tabs/profiles/ProfilesPage'
import { ListsPage } from './tabs/lists/ListsPage'
import { DashboardPage } from './tabs/dashboard/DashboardPage'
import { LogsPage } from './tabs/logs/LogsPage'
import { InstagramPage } from './tabs/instagram'
import { ModeToggle } from '@/components/mode-toggle'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import type { NavId } from '@/components/app-sidebar'
import { Separator } from '@/components/ui/separator'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

function App() {
  const [activeId, setActiveId] = useState<NavId>(() => {
    return (localStorage.getItem('anti-active-tab') as NavId) || 'dashboard'
  })

  useEffect(() => {
    localStorage.setItem('anti-active-tab', activeId)
  }, [activeId])

  const renderContent = () => {
    switch (activeId) {
      case 'dashboard':
        return <DashboardPage />
      case 'profiles':
        return <ProfilesPage />
      case 'lists':
        return <ListsPage />
      case 'instagram':
        return <InstagramPage />
      case 'logs':
        return <LogsPage />
      default:
        return <DashboardPage />
    }
  }

  const getBreadcrumbLabel = (id: NavId) => {
    switch (id) {
      case 'dashboard': return 'Dashboard'
      case 'profiles': return 'Profiles Manager'
      case 'instagram': return 'Instagram Automation'
      case 'lists': return 'Lists Manager'
      case 'logs': return 'Logs'
      default: return 'Dashboard'
    }
  }

  return (
    <SidebarProvider>
      <AppSidebar activeId={activeId} onNavigate={setActiveId} />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="#" onClick={(e) => { e.preventDefault(); setActiveId('dashboard'); }}>
                    Anti
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>{getBreadcrumbLabel(activeId)}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="ml-auto px-4">
            <ModeToggle />
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          {renderContent()}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default App
