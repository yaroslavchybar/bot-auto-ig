import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentType,
  type LazyExoticComponent,
} from 'react'
import { UserMenu } from '@/components/layout/user-menu'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { AppSidebar, NAV_IDS } from '@/components/layout/app-sidebar'
import type { NavId } from '@/components/layout/app-sidebar'
import { Separator } from '@/components/ui/separator'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { useAuthenticatedFetch } from '@/hooks/useAuthenticatedFetch'
import { ConvexClientProvider } from '@/components/layout/ConvexClientProvider'
import { Toaster } from '@/components/ui/toaster'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

const ProfilesPage = lazy(() =>
  import('./features/profiles/ProfilesPage').then((module) => ({
    default: module.ProfilesPage,
  })),
)
const ListsPage = lazy(() =>
  import('./features/lists/ListsPage').then((module) => ({
    default: module.ListsPage,
  })),
)
const LogsPage = lazy(() =>
  import('./features/logs/LogsPage').then((module) => ({
    default: module.LogsPage,
  })),
)
const AccountsPage = lazy(() =>
  import('./features/accounts/AccountsPage').then((module) => ({
    default: module.AccountsPage,
  })),
)
const ScrapingPage = lazy(() =>
  import('./features/scraping/ScrapingPage').then((module) => ({
    default: module.ScrapingPage,
  })),
)
const WorkflowsPage = lazy(() =>
  import('./features/workflows/WorkflowsPage').then((module) => ({
    default: module.WorkflowsPage,
  })),
)
const VncPage = lazy(() =>
  import('./features/vnc/VncPage').then((module) => ({
    default: module.VncPage,
  })),
)
const MonitoringPage = lazy(() =>
  import('./features/monitoring/MonitoringPage').then((module) => ({
    default: module.MonitoringPage,
  })),
)

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
      case 'profiles':
        return 'Profiles Manager'
      case 'workflows':
        return 'Workflows'
      case 'scraping':
        return 'Scraping'
      case 'lists':
        return 'Lists Manager'
      case 'accounts':
        return 'Upload Accounts'
      case 'logs':
        return 'Logs'
      case 'vnc':
        return 'Browser View'
      case 'monitoring':
        return 'VPS Monitor'
      default:
        return 'Profiles Manager'
    }
  }

  const ActivePage = NAV_COMPONENTS[activeId] ?? ProfilesPage

  return (
    <SidebarProvider className="h-svh min-w-0 overflow-hidden">
      <AppSidebar activeId={activeId} onNavigate={setActiveId} />
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden bg-transparent">
        <header className="border-line-soft bg-panel-subtle relative z-10 flex h-16 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex min-w-0 items-center gap-2 px-4">
            <SidebarTrigger className="text-muted-copy hover:text-ink -ml-1" />
            <Separator
              orientation="vertical"
              className="bg-panel-hover mr-2 h-4"
            />
            <Breadcrumb className="min-w-0">
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      setActiveId('profiles')
                    }}
                    className="text-muted-copy hover:text-ink transition-colors"
                  >
                    Anti
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="text-subtle-copy hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage className="page-title-gradient text-lg font-medium">
                    {getBreadcrumbLabel(activeId)}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="ml-auto flex items-center gap-2 px-4">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden p-4 pt-0">
          <div className="min-h-0 min-w-0 flex-1">
            <Suspense
              fallback={
                <div className="border-line-soft bg-panel-subtle text-subtle-copy flex h-full min-h-[240px] items-center justify-center rounded-2xl border text-sm">
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


