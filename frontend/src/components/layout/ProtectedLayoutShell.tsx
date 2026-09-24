import type { ReactNode } from 'react'
import { UserMenu } from '@/components/layout/user-menu'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { ConvexClientProvider } from '@/components/layout/ConvexClientProvider'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { parseSidebarOpen } from '@/lib/sidebar-state'
import type { RouteMeta } from '@/lib/routes'
import { useLocation, useNavigate } from '@/lib/router'
import { cn } from '@/lib/utils'
import { SCRAPER_TABS, parseScraperTab, type ScraperTabId } from '@/features/scraper/scraperTabs'
import { useVncSessions } from '@/features/vnc/hooks/useVncSessions'

type ProtectedLayoutShellProps = {
  routeMeta: RouteMeta
  pathname: string
  children: ReactNode
}

function readSidebarDefaultOpen() {
  if (typeof document === 'undefined') return true
  return parseSidebarOpen(document.cookie)
}

export function ProtectedLayoutShell({
  routeMeta,
  pathname,
  children,
}: ProtectedLayoutShellProps) {

  const breadcrumb = routeMeta.breadcrumb ?? 'Profiles Manager'
  const appChrome = routeMeta.appChrome ?? 'default'
  const showVncCount = pathname === '/vnc'
  const showScraperTabs = pathname === '/scraper'
  const showChatSlot = pathname === '/chat'

  if (appChrome === 'immersive') {
    return (
      <ConvexClientProvider>
          <div className="bg-shell flex h-svh min-w-0 flex-col overflow-hidden">
            <div className="min-h-0 min-w-0 flex-1">
              {children}
            </div>
          </div>
      </ConvexClientProvider>
    )
  }

  return (
    <ConvexClientProvider>
        <SidebarProvider
          defaultOpen={readSidebarDefaultOpen()}
          className="h-svh min-w-0 overflow-hidden"
        >
          <AppSidebar />
          <SidebarInset className="min-h-0 min-w-0 overflow-hidden bg-transparent">
            <header className="border-line-soft bg-panel-subtle relative z-10 flex h-16 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
              <div className="flex min-w-0 items-center gap-2 px-4">
                <SidebarTrigger className="text-muted-copy hover:text-ink -ml-1 size-8 md:hidden" />
                <Breadcrumb className="min-w-0">
                  <BreadcrumbList>
                    <BreadcrumbItem className="flex items-center gap-2">
                      <BreadcrumbPage className="page-title-gradient text-lg font-medium">
                        {breadcrumb}
                      </BreadcrumbPage>
                      {showVncCount ? <VncActiveCount /> : null}
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
              {showChatSlot ? <div id="chat-header-slot" className="hidden min-w-0 flex-1 items-center md:flex" /> : null}
              {showScraperTabs ? <ScraperHeaderTabs /> : null}
              <div className="ml-auto flex items-center gap-2 px-4">
                <ThemeToggle />
                <UserMenu />
              </div>
            </header>
            <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pt-0">
              <div className="min-h-0 min-w-0 flex-1">
                {children}
              </div>
            </div>
            </SidebarInset>
        </SidebarProvider>
    </ConvexClientProvider>
  )
}

// Center tab switch for the Scraper page (Jobs / Scraping accounts / Saved accounts).
// State lives in the URL (?tab=...) so the header and page stay in sync.
function ScraperHeaderTabs() {
  const { search } = useLocation()
  const navigate = useNavigate()
  const active = parseScraperTab(new URLSearchParams(search).get('tab'))

  const select = (tab: ScraperTabId) => {
    if (tab === active) return
    navigate(`/scraper?tab=${tab}`)
  }

  return (
    <nav aria-label="Scraper sections" className="hidden min-w-0 flex-1 items-center justify-center md:flex">
      <div className="button-toolbar-group flex items-center gap-1 rounded-full p-1">
        {SCRAPER_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => select(tab.id)}
            aria-current={tab.id === active ? 'page' : undefined}
            className={cn(
              'h-7 rounded-full px-3 text-xs font-medium whitespace-nowrap transition-colors',
              tab.id === active
                ? 'bg-panel-muted text-ink shadow-xs'
                : 'text-muted-copy hover:text-ink',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </nav>
  )
}

// Shows live VNC session count next to the "Browser View" breadcrumb.
// Mounted only on /vnc so polling pauses on other routes.
function VncActiveCount() {
  const { sessions } = useVncSessions(true)
  return (
    <span className="text-subtle-copy font-mono text-xs">[{sessions.length} live]</span>
  )
}
