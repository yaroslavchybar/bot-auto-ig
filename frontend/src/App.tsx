import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { UserMenu } from '@/components/user-menu'
import { ProfilesPage } from './tabs/profiles/ProfilesPage'
import { ListsPage } from './tabs/lists/ListsPage'
import { DashboardPage } from './tabs/dashboard/DashboardPage'
import { LogsPage } from './tabs/logs/LogsPage'
import { AccountsPage } from './tabs/accounts/AccountsPage'
import { ScrapingPage } from './tabs/scraping/ScrapingPage'
import { WorkflowsPage } from './tabs/workflows'
import { VncPage } from './tabs/vnc'
import { MonitoringPage } from './tabs/monitoring/MonitoringPage'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import type { NavId } from '@/components/app-sidebar'
import { Separator } from '@/components/ui/separator'
import { AuthGuard } from '@/components/AuthGuard'
import { SignInPage } from '@/pages/SignInPage'
import { SignUpPage } from '@/pages/SignUpPage'
import { useAuthenticatedFetch } from '@/hooks/useAuthenticatedFetch'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

function MainLayout() {
  const [activeId, setActiveId] = useState<NavId>(() => {
    return (localStorage.getItem('anti-active-tab') as NavId) || 'dashboard'
  })

  // Initialize authenticated fetch (sets up token getter for API calls)
  useAuthenticatedFetch()

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
      case 'workflows':
        return <WorkflowsPage />
      case 'scraping':
        return <ScrapingPage />
      case 'accounts':
        return <AccountsPage />
      case 'logs':
        return <LogsPage />
      case 'vnc':
        return <VncPage />
      case 'monitoring':
        return <MonitoringPage />
      default:
        return <DashboardPage />
    }
  }

  const getBreadcrumbLabel = (id: NavId) => {
    switch (id) {
      case 'dashboard': return 'Dashboard'
      case 'profiles': return 'Profiles Manager'
      case 'workflows': return 'Workflows'
      case 'scraping': return 'Scraping'
      case 'lists': return 'Lists Manager'
      case 'accounts': return 'Upload Accounts'
      case 'logs': return 'Logs'
      case 'vnc': return 'Browser View'
      case 'monitoring': return 'VPS Monitor'
      default: return 'Dashboard'
    }
  }

  return (
    <SidebarProvider className="h-svh min-w-0 overflow-hidden">
      <AppSidebar activeId={activeId} onNavigate={setActiveId} />
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden bg-transparent">
        <header className="flex h-16 shrink-0 items-center gap-2 border-b border-white/5 bg-white/[0.02] transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 relative z-10">
          <div className="flex min-w-0 items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1 text-gray-400 hover:text-gray-200" />
            <Separator orientation="vertical" className="mr-2 h-4 bg-white/10" />
            <Breadcrumb className="min-w-0">
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="#" onClick={(e) => { e.preventDefault(); setActiveId('dashboard'); }} className="text-gray-400 hover:text-gray-200 transition-colors">
                    Anti
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block text-gray-500" />
                <BreadcrumbItem>
                  <BreadcrumbPage className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent font-medium text-lg">
                    {getBreadcrumbLabel(activeId)}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="ml-auto px-4 flex items-center gap-2">
            <UserMenu />
          </div>
        </header>
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden p-4 pt-0 min-h-0 relative z-10">
          <div className="min-h-0 min-w-0 flex-1">
            {renderContent()}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/sign-in/*" element={<SignInPage />} />
        <Route path="/sign-up/*" element={<SignUpPage />} />
        <Route
          path="/*"
          element={
            <AuthGuard>
              <MainLayout />
            </AuthGuard>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}

export default App
