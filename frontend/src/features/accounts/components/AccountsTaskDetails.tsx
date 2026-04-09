import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FileSpreadsheet, Loader2 } from 'lucide-react'
import type { AccountsState } from '../hooks/useAccountsState'
import { USERNAME_ALIASES, formatDate } from '../hooks/useAccountsState'
import {
  MetricCard,
  ProcessingResultPanel,
  SamplePreview,
  StatusBanner,
} from './AccountsShared'

interface AccountsTaskDetailsProps {
  accounts: AccountsState
}

function TaskDetailHeader({
  activeMode,
  csvStep,
}: {
  activeMode: AccountsState['activeMode']
  csvStep: AccountsState['state']['step']
}) {
  const isCsvActive = activeMode === 'csv' && csvStep !== 'idle'

  return (
    <div className="flex items-center gap-2">
      <div className="brand-surface brand-text flex h-10 w-10 items-center justify-center rounded-xl border">
        <FileSpreadsheet className="h-5 w-5" />
      </div>
      <div>
        <h3 className="text-lg font-semibold">
          {isCsvActive ? 'CSV import details' : 'Artifact details'}
        </h3>
        <p className="text-subtle-copy text-sm">
          {isCsvActive
            ? 'Review the uploaded CSV, then filter and import it from this panel.'
            : 'Select a completed workflow scrape artifact to review, filter, and import.'}
        </p>
      </div>
    </div>
  )
}

function TaskDetailPlaceholder() {
  return (
    <div className="text-subtle-copy border-line mt-5 rounded-2xl border border-dashed px-4 py-10 text-center text-sm">
      Pick an artifact from the list to inspect the detected account data
      before filtering and importing.
    </div>
  )
}

function ArtifactInfoCard({
  accounts,
}: AccountsTaskDetailsProps) {
  const {
    selectedTask,
    selectedTaskPreview,
    selectedTaskDetectedUsernameField,
    selectedTaskDetectedFullNameField,
    selectedTaskPreviewFields,
  } = accounts

  if (!selectedTask || !selectedTaskPreview) return null

  return (
    <>
      <div className="bg-panel-strong border-line rounded-2xl border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-ink truncate text-lg font-semibold">
              {selectedTask.name || 'Untitled artifact'}
            </div>
            <div className="text-subtle-copy mt-1 text-sm">
              Created {formatDate(selectedTask.createdAt)}
            </div>
          </div>
          <Badge
            variant="outline"
            className="border-line bg-panel-muted text-copy"
          >
            {selectedTask.kind || '-'}
          </Badge>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <MetricCard
            label="Rows"
            value={selectedTaskPreview.rowCount.toLocaleString()}
          />
          <MetricCard
            label="Username Source"
            value={selectedTaskDetectedUsernameField ?? 'Missing'}
            accent={selectedTaskDetectedUsernameField ? 'success' : 'danger'}
          />
          <MetricCard
            label="Full Name Source"
            value={selectedTaskDetectedFullNameField ?? 'Not detected'}
          />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2">
          <div className="text-subtle-copy text-[11px] font-semibold tracking-[0.18em] uppercase">
            Sample Preview
          </div>
          <Badge
            variant="outline"
            className="border-line bg-panel-muted text-copy"
          >
            Auto-mapped
          </Badge>
        </div>
        <SamplePreview
          fields={selectedTaskPreviewFields}
          sampleRow={selectedTaskPreview.sampleRow}
          detectedUsernameField={selectedTaskDetectedUsernameField}
          detectedFullNameField={selectedTaskDetectedFullNameField}
          emptyMessage="No sample data is available for this artifact."
        />
      </div>
    </>
  )
}

function TaskDetailContent({ accounts }: AccountsTaskDetailsProps) {
  const {
    selectedTask,
    selectedTaskPreview,
    selectedTaskMissingUsername,
    selectedTaskId,
    processingTaskId,
    scrapingResult,
    handleScrapingReset,
    handleProcessTask,
  } = accounts

  if (!selectedTask || !selectedTaskPreview) return null

  return (
    <div className="mt-5 space-y-5">
      {scrapingResult ? (
        <ProcessingResultPanel
          title="Workflow scrape import complete"
          summary={scrapingResult}
          actionLabel="Import another artifact"
          onReset={handleScrapingReset}
        />
      ) : null}

      {selectedTaskMissingUsername ? (
        <StatusBanner tone="warning">
          This artifact does not expose a supported username field. Expected
          one of: {USERNAME_ALIASES.join(', ')}.
        </StatusBanner>
      ) : null}

      <ArtifactInfoCard accounts={accounts} />

      <Button
        onClick={() => void handleProcessTask()}
        disabled={
          selectedTaskMissingUsername ||
          processingTaskId === selectedTaskId
        }
        className="brand-button h-11 w-full"
      >
        {processingTaskId === selectedTaskId ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Processing
          </>
        ) : (
          'Filter & Import'
        )}
      </Button>
    </div>
  )
}

function CsvInfoCard({ accounts }: AccountsTaskDetailsProps) {
  const {
    state,
    csvDetectedUsernameField,
    csvDetectedFullNameField,
    csvPreviewFields,
  } = accounts

  if (state.step !== 'selecting') return null

  return (
    <>
      <div className="bg-panel-strong border-line rounded-2xl border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-ink truncate text-lg font-semibold">
              {state.fileName}
            </div>
            <div className="text-subtle-copy mt-1 text-sm">
              Uploaded CSV preview
            </div>
          </div>
          <Badge
            variant="outline"
            className="border-line bg-panel-muted text-copy"
          >
            CSV
          </Badge>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <MetricCard label="Rows" value={state.rowCount.toLocaleString()} />
          <MetricCard
            label="Username Source"
            value={csvDetectedUsernameField ?? 'Missing'}
            accent={csvDetectedUsernameField ? 'success' : 'danger'}
          />
          <MetricCard
            label="Full Name Source"
            value={csvDetectedFullNameField ?? 'Not detected'}
          />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2">
          <div className="text-subtle-copy text-[11px] font-semibold tracking-[0.18em] uppercase">
            Sample Preview
          </div>
          <Badge
            variant="outline"
            className="border-line bg-panel-muted text-copy"
          >
            Auto-mapped
          </Badge>
        </div>
        <SamplePreview
          fields={csvPreviewFields}
          sampleRow={state.sampleRow}
          detectedUsernameField={csvDetectedUsernameField}
          detectedFullNameField={csvDetectedFullNameField}
          emptyMessage="No sample row is available for this file."
        />
      </div>
    </>
  )
}

function CsvDetailContent({ accounts }: AccountsTaskDetailsProps) {
  const {
    state,
    csvMissingUsername,
    handleCsvReset,
    handleProcessCsv,
  } = accounts

  if (state.step === 'completed') {
    return (
      <div className="mt-5">
        <ProcessingResultPanel
          title="CSV upload complete"
          summary={{
            stats: state.stats,
            uploaded: state.uploaded,
            duplicates: state.duplicates,
          }}
          actionLabel="Upload another file"
          onReset={handleCsvReset}
        />
      </div>
    )
  }

  if (state.step === 'processing' || state.step === 'uploading') {
    return (
      <div className="mt-5 flex items-center justify-center px-4 py-10 text-sm">
        <Loader2 className="text-brand mr-2 h-4 w-4 animate-spin" />
        {state.step === 'uploading'
          ? 'Uploading CSV preview...'
          : 'Processing CSV import...'}
      </div>
    )
  }

  if (state.step === 'error') {
    return (
      <div className="mt-5">
        <StatusBanner tone="danger">{state.message}</StatusBanner>
      </div>
    )
  }

  if (state.step !== 'selecting') {
    return <TaskDetailPlaceholder />
  }

  return (
    <div className="mt-5 space-y-5">
      {csvMissingUsername ? (
        <StatusBanner tone="warning">
          This CSV does not expose a supported username field. Expected one of:{' '}
          {USERNAME_ALIASES.join(', ')}.
        </StatusBanner>
      ) : (
        <StatusBanner tone="success">
          Username column detected automatically. Review the preview and import.
        </StatusBanner>
      )}

      <CsvInfoCard accounts={accounts} />

      <Button
        onClick={handleProcessCsv}
        disabled={csvMissingUsername}
        className="brand-button h-11 w-full"
      >
        Process & Upload
      </Button>
    </div>
  )
}

export function AccountsTaskDetails({
  accounts,
}: AccountsTaskDetailsProps) {
  const {
    activeMode,
    state,
    selectedTaskError,
    selectedTaskLoading,
    selectedTask,
    selectedTaskPreview,
  } = accounts
  const showCsvDetails = activeMode === 'csv' && state.step !== 'idle'

  return (
    <div className="bg-panel-subtle border-line-soft h-fit rounded-3xl border p-5 shadow-xs backdrop-blur-xs xl:sticky xl:top-28">
      <TaskDetailHeader activeMode={activeMode} csvStep={state.step} />

      {!showCsvDetails && selectedTaskError ? (
        <div className="mt-5">
          <StatusBanner tone="danger">{selectedTaskError}</StatusBanner>
        </div>
      ) : null}

      {showCsvDetails ? (
        <CsvDetailContent accounts={accounts} />
      ) : selectedTaskLoading ? (
        <div className="flex items-center justify-center px-4 py-10 text-sm">
          <Loader2 className="text-brand mr-2 h-4 w-4 animate-spin" />
          Loading artifact preview...
        </div>
      ) : !selectedTask || !selectedTaskPreview ? (
        <TaskDetailPlaceholder />
      ) : (
        <TaskDetailContent accounts={accounts} />
      )}
    </div>
  )
}
