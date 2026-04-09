import { Button } from '@/components/ui/button'
import { AmbientGlow } from '@/components/ui/ambient-glow'
import { useIsMobile } from '@/hooks/use-mobile'
import { RefreshCw, RotateCcw, Upload } from 'lucide-react'
import { useAccountsState } from '../hooks/useAccountsState'
import { AccountsTaskList } from '../components/AccountsTaskList'
import { AccountsTaskDetails } from '../components/AccountsTaskDetails'

function AccountsToolbar({
  activeMode,
  csvDirty,
  scrapingDirty,
  isCsvBusy,
  isScrapingBusy,
  isMobile,
  onOpenCsvUpload,
  onResetActiveMode,
  onRefreshScrapingTasks,
}: {
  activeMode: 'csv' | 'scraping'
  csvDirty: boolean
  scrapingDirty: boolean
  isCsvBusy: boolean
  isScrapingBusy: boolean
  isMobile: boolean
  onOpenCsvUpload: () => void
  onResetActiveMode: () => void
  onRefreshScrapingTasks: () => void
}) {
  const showReset =
    (activeMode === 'csv' && csvDirty) ||
    (activeMode === 'scraping' && scrapingDirty)

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        size={isMobile ? 'default' : 'sm'}
        onClick={onOpenCsvUpload}
        disabled={isCsvBusy}
      >
        <Upload className={isMobile ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
        <span>Upload CSV</span>
      </Button>

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

function AccountsPageHeader({
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
    fileInputRef,
    handleFileSelect,
    handleResetActiveMode,
    handleRefreshScrapingTasks,
    setActiveMode,
  } = accounts

  function handleOpenCsvUpload() {
    setActiveMode('csv')
    fileInputRef.current?.click()
  }

  return (
    <div className="relative z-10 flex-none px-4 pt-2 pb-2 md:px-6 md:pt-3 md:pb-3">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        onChange={handleFileSelect}
        className="hidden"
      />

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-end">
        <AccountsToolbar
          activeMode={activeMode}
          csvDirty={csvDirty}
          scrapingDirty={scrapingDirty}
          isCsvBusy={isCsvBusy}
          isScrapingBusy={isScrapingBusy}
          isMobile={isMobile}
          onOpenCsvUpload={handleOpenCsvUpload}
          onResetActiveMode={handleResetActiveMode}
          onRefreshScrapingTasks={() =>
            void handleRefreshScrapingTasks()
          }
        />
      </div>
    </div>
  )
}

export function AccountsPageContainer() {
  const isMobile = useIsMobile()
  const accounts = useAccountsState()

  return (
    <div className="bg-shell text-ink animate-in fade-in relative flex h-full flex-col duration-300">
      <AmbientGlow />

      <div className="flex h-full flex-col">
        <AccountsPageHeader accounts={accounts} isMobile={isMobile} />
        <div className="flex-1 overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
          <div className="mx-auto max-w-[2000px]">
            <AccountsTaskList
              accounts={accounts}
              isMobile={isMobile}
              detailsPanel={<AccountsTaskDetails accounts={accounts} />}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
