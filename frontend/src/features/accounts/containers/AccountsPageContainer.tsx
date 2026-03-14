import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AmbientGlow } from '@/components/ui/ambient-glow'
import { useIsMobile } from '@/hooks/use-mobile'
import { RefreshCw, RotateCcw } from 'lucide-react'
import { useAccountsState } from '../hooks/useAccountsState'
import type { AccountsMode } from '../hooks/useAccountsState'
import { StatusBanner } from '../components/AccountsShared'
import { AccountsUploadSection } from '../components/AccountsUploadSection'
import { AccountsTaskList } from '../components/AccountsTaskList'
import { AccountsTaskDetails } from '../components/AccountsTaskDetails'

function AccountsToolbar({
  activeMode,
  csvDirty,
  scrapingDirty,
  isCsvBusy,
  isScrapingBusy,
  isMobile,
  onResetActiveMode,
  onRefreshScrapingTasks,
}: {
  activeMode: AccountsMode
  csvDirty: boolean
  scrapingDirty: boolean
  isCsvBusy: boolean
  isScrapingBusy: boolean
  isMobile: boolean
  onResetActiveMode: () => void
  onRefreshScrapingTasks: () => void
}) {
  const showReset =
    (activeMode === 'csv' && csvDirty) ||
    (activeMode === 'scraping' && scrapingDirty)

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
      {activeMode === 'scraping' ? (
        <Button
          variant="outline"
          size="icon"
          onClick={onRefreshScrapingTasks}
          disabled={isScrapingBusy}
          aria-label="Refresh workflow scrape artifacts"
          title="Refresh workflow scrape artifacts"
          className="h-8 w-8 shrink-0 p-0"
        >
          <RefreshCw
            className={isScrapingBusy ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
          />
          <span className="sr-only">Refresh</span>
        </Button>
      ) : null}

      {showReset && (
        <Button
          variant="outline"
          size={isMobile ? 'default' : 'sm'}
          onClick={onResetActiveMode}
          disabled={activeMode === 'csv' ? isCsvBusy : isScrapingBusy}
        >
          <RotateCcw
            className={isMobile ? 'h-4 w-4' : 'mr-2 h-3.5 w-3.5'}
          />
          <span>Start over</span>
        </Button>
      )}
    </div>
  )
}

function AccountsTabHeader({
  accounts,
  isMobile,
}: {
  accounts: ReturnType<typeof useAccountsState>
  isMobile: boolean
}) {
  const {
    activeMode,
    csvDirty,
    scrapingDirty,
    isCsvBusy,
    isScrapingBusy,
    handleResetActiveMode,
    handleRefreshScrapingTasks,
  } = accounts

  return (
    <div className="relative z-10 flex-none px-4 pt-2 pb-2 md:px-6 md:pt-3 md:pb-3">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-end">
        <div className="flex flex-col gap-2 md:items-end">
          <TabsList className="bg-panel-muted border-line h-11 rounded-xl border p-1">
            <TabsTrigger
              value="csv"
              className="data-[state=active]:bg-panel-strong data-[state=active]:text-ink rounded-lg px-4"
            >
              CSV Upload
            </TabsTrigger>
            <TabsTrigger
              value="scraping"
              className="data-[state=active]:bg-panel-strong data-[state=active]:text-ink rounded-lg px-4"
            >
              Workflow Scrape Import
            </TabsTrigger>
          </TabsList>

          <AccountsToolbar
            activeMode={activeMode}
            csvDirty={csvDirty}
            scrapingDirty={scrapingDirty}
            isCsvBusy={isCsvBusy}
            isScrapingBusy={isScrapingBusy}
            isMobile={isMobile}
            onResetActiveMode={handleResetActiveMode}
            onRefreshScrapingTasks={() =>
              void handleRefreshScrapingTasks()
            }
          />
        </div>
      </div>
    </div>
  )
}

export function AccountsPageContainer() {
  const isMobile = useIsMobile()
  const accounts = useAccountsState()
  const { state, activeMode, setActiveMode } = accounts

  return (
    <div className="bg-shell text-ink animate-in fade-in relative flex h-full flex-col duration-300">
      <AmbientGlow />

      <Tabs
        value={activeMode}
        onValueChange={(value) => setActiveMode(value as AccountsMode)}
        className="flex h-full flex-col"
      >
        <AccountsTabHeader accounts={accounts} isMobile={isMobile} />

        {activeMode === 'csv' && state.step === 'error' ? (
          <StatusBanner tone="danger">{state.message}</StatusBanner>
        ) : null}

        <div className="flex-1 overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
          <div className="mx-auto max-w-[2000px]">
            <TabsContent value="csv" className="mt-0 outline-none">
              <AccountsUploadSection accounts={accounts} />
            </TabsContent>

            <TabsContent value="scraping" className="mt-0 outline-none">
              <AccountsTaskList
                accounts={accounts}
                isMobile={isMobile}
                detailsPanel={<AccountsTaskDetails accounts={accounts} />}
              />
            </TabsContent>
          </div>
        </div>
      </Tabs>
    </div>
  )
}
