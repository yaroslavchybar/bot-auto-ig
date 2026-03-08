import { lazy, Suspense, useEffect, useState, type ComponentType, type LazyExoticComponent } from 'react'
import { UserMenu } from '@/components/user-menu'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar, NAV_IDS } from '@/components/app-sidebar'
import type { NavId } from '@/components/app-sidebar'
import { Separator } from '@/components/ui/separator'
import { AuthGuard } from '@/components/AuthGuard'
import { useAuthenticatedFetch } from '@/hooks/useAuthenticatedFetch'
import { ConvexClientProvider } from '@/components/ConvexClientProvider'
import { Toaster } from '@/components/ui/toaster'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

const ProfilesPage = lazy(() => import('./tabs/profiles/ProfilesPage').then((module) => ({ default: module.ProfilesPage })))
const ListsPage = lazy(() => import('./tabs/lists/ListsPage').then((module) => ({ default: module.ListsPage })))
const LogsPage = lazy(() => import('./tabs/logs/LogsPage').then((module) => ({ default: module.LogsPage })))
const AccountsPage = lazy(() => import('./tabs/accounts/AccountsPage').then((module) => ({ default: module.AccountsPage })))
const ScrapingPage = lazy(() => import('./tabs/scraping/ScrapingPage').then((module) => ({ default: module.ScrapingPage })))
const WorkflowsPage = lazy(() => import('./tabs/workflows/WorkflowsPage').then((module) => ({ default: module.WorkflowsPage })))
const VncPage = lazy(() => import('./tabs/vnc/VncPage').then((module) => ({ default: module.VncPage })))
const MonitoringPage = lazy(() => import('./tabs/monitoring/MonitoringPage').then((module) => ({ default: module.MonitoringPage })))

const NAV_COMPONENTS: Record<NavId, LazyExoticComponent<ComponentType>> = {
  profiles: ProfilesPage,
  lists: ListsPage,
  workflows: WorkflowsPage,
  scraping: ScrapingPage,
  accounts: AccountsPage,
  logs: LogsPage,
  vnc: VncPage,
  monitoring: MonitoringPage,
}

function getInitialNavId(): NavId {
  const savedId = localStorage.getItem('anti-active-tab')
  if (savedId && NAV_IDS.includes(savedId as NavId)) {
    return savedId as NavId
  }
  return 'profiles'
}

function ProtectedLayout() {
  const [activeId, setActiveId] = useState<NavId>(() => getInitialNavId())

  useAuthenticatedFetch()

  useEffect(() => {
    localStorage.setItem('anti-active-tab', activeId)
  }, [activeId])

  const getBreadcrumbLabel = (id: NavId) => {
    switch (id) {
      case 'profiles': return 'Profiles Manager'
      case 'workflows': return 'Workflows'
      case 'scraping': return 'Scraping'
      case 'lists': return 'Lists Manager'
      case 'accounts': return 'Upload Accounts'
      case 'logs': return 'Logs'
      case 'vnc': return 'Browser View'
      case 'monitoring': return 'VPS Monitor'
      default: return 'Profiles Manager'
    }
  }

  const ActivePage = NAV_COMPONENTS[activeId] ?? ProfilesPage

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
                  <BreadcrumbLink href="#" onClick={(e) => { e.preventDefault(); setActiveId('profiles') }} className="text-gray-400 hover:text-gray-200 transition-colors">
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
            <Suspense
              fallback={
                <div className="flex h-full min-h-[240px] items-center justify-center rounded-2xl border border-white/5 bg-white/[0.02] text-sm text-gray-500">
                  Loading {getBreadcrumbLabel(activeId)}...
                </div>
              }
            >
              <ActivePage />
            </Suspense>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default function ProtectedApp() {
  return (
    <AuthGuard>
      <ConvexClientProvider>
        <ProtectedLayout />
        <Toaster />
      </ConvexClientProvider>
    </AuthGuard>
  )
}
