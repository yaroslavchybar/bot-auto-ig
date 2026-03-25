import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import type { AccountsState } from '../hooks/useAccountsState'
import {
  MetricCard,
  ProcessingResultPanel,
  SamplePreview,
  StatusBanner,
} from './AccountsShared'

interface AccountsUploadSectionProps {
  accounts: AccountsState
}

function CsvDropZone({ accounts }: AccountsUploadSectionProps) {
  const { state, fileInputRef, dragActive, handleDrag, handleDrop, handleFileSelect } =
    accounts

  return (
    <div className="bg-panel-subtle border-line-soft rounded-3xl border p-5 shadow-xs backdrop-blur-xs">
      <div
        className={cn(
          'flex min-h-[280px] cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed px-6 py-10 text-center transition-colors',
          dragActive
            ? 'border-brand bg-brand/8'
            : 'border-line hover:border-line-strong bg-panel-strong',
          state.step === 'uploading' && 'pointer-events-none opacity-60',
        )}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileSelect}
          className="hidden"
        />
        {state.step === 'uploading' ? (
          <>
            <Loader2 className="text-brand h-10 w-10 animate-spin" />
            <h3 className="mt-4 text-xl font-semibold">Uploading file</h3>
            <p className="text-subtle-copy mt-2 text-sm">
              Parsing headers and preparing the account preview.
            </p>
          </>
        ) : (
          <>
            <div className="brand-surface brand-text flex h-16 w-16 items-center justify-center rounded-2xl border">
              <Upload className="h-8 w-8" />
            </div>
            <h3 className="mt-4 text-2xl font-semibold">
              Drop a CSV file to import accounts
            </h3>
            <p className="text-subtle-copy mt-2 max-w-xl text-sm">
              The uploader will detect the username and optional full-name
              columns automatically, then send the cleaned results into the
              account pipeline.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button className="brand-button">
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Browse CSV
              </Button>
              <span className="text-subtle-copy text-xs tracking-[0.18em] uppercase">
                CSV only
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function CsvSelecting({ accounts }: AccountsUploadSectionProps) {
  const {
    state,
    csvDetectedUsernameField,
    csvDetectedFullNameField,
    csvPreviewFields,
    csvMissingUsername,
    handleProcessCsv,
  } = accounts

  if (state.step !== 'selecting') return null

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(360px,0.9fr)]">
      <div className="space-y-4">
        {csvMissingUsername ? (
          <StatusBanner tone="warning">
            No supported username column was detected. Add one of:{' '}
            {['user_name', 'userName', 'username', 'login', 'User Name'].join(
              ', ',
            )}
            .
          </StatusBanner>
        ) : (
          <StatusBanner tone="success">
            Username column detected automatically. Review the preview and
            process the upload.
          </StatusBanner>
        )}

        <CsvDetectedDataPanel
          state={state}
          csvDetectedUsernameField={csvDetectedUsernameField}
          csvDetectedFullNameField={csvDetectedFullNameField}
          csvPreviewFields={csvPreviewFields}
        />
      </div>

      <CsvProcessSidebar
        csvMissingUsername={csvMissingUsername}
        onProcessCsv={handleProcessCsv}
      />
    </div>
  )
}

function CsvDetectedDataPanel({
  state,
  csvDetectedUsernameField,
  csvDetectedFullNameField,
  csvPreviewFields,
}: {
  state: Extract<AccountsState['state'], { step: 'selecting' }>
  csvDetectedUsernameField: string | null
  csvDetectedFullNameField: string | null
  csvPreviewFields: string[]
}) {
  return (
    <div className="bg-panel-subtle border-line-soft rounded-3xl border p-5 shadow-xs backdrop-blur-xs">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-xl font-semibold">Detected Data</h3>
          <p className="text-subtle-copy mt-1 text-sm">
            The uploader is using backend alias rules to infer the account
            fields before processing.
          </p>
        </div>
        <Badge
          variant="outline"
          className="border-line bg-panel-muted text-copy w-fit"
        >
          {state.fileName}
        </Badge>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
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

      <div className="mt-5">
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
    </div>
  )
}

function CsvProcessSidebar({
  csvMissingUsername,
  onProcessCsv,
}: {
  csvMissingUsername: boolean
  onProcessCsv: () => void
}) {
  return (
    <div className="bg-panel-subtle border-line-soft h-fit rounded-3xl border p-5 shadow-xs backdrop-blur-xs xl:sticky xl:top-28">
      <div className="flex items-center gap-2">
        <div className="brand-surface brand-text flex h-10 w-10 items-center justify-center rounded-xl border">
          <FileSpreadsheet className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Ready to Process</h3>
          <p className="text-subtle-copy text-sm">
            Upload will run with the fixed account destination.
          </p>
        </div>
      </div>

      <div className="bg-panel-strong border-line mt-5 rounded-2xl border p-4">
        <div className="text-subtle-copy text-[11px] font-semibold tracking-[0.18em] uppercase">
          Processing notes
        </div>
        <ul className="text-copy mt-3 space-y-2 text-sm">
          <li>Keyword filtering and deduplication run automatically.</li>
          <li>Only valid usernames continue into the upload.</li>
          <li>Full name and matched keyword metadata are preserved.</li>
        </ul>
      </div>

      <Button
        onClick={onProcessCsv}
        disabled={csvMissingUsername}
        className="brand-button mt-5 h-11 w-full"
      >
        Process & Upload
      </Button>
    </div>
  )
}

function CsvProcessing() {
  return (
    <div className="bg-panel-subtle border-line-soft rounded-3xl border p-8 shadow-xs backdrop-blur-xs">
      <div className="flex flex-col items-center justify-center text-center">
        <Loader2 className="text-brand h-10 w-10 animate-spin" />
        <h3 className="mt-4 text-xl font-semibold">Processing upload</h3>
        <p className="text-subtle-copy mt-2 text-sm">
          Filtering accounts, removing duplicates, and uploading the cleaned
          result.
        </p>
      </div>
    </div>
  )
}

export function AccountsUploadSection({
  accounts,
}: AccountsUploadSectionProps) {
  const { state, handleCsvReset } = accounts

  return (
    <div className="space-y-4">
      {(state.step === 'idle' ||
        state.step === 'uploading' ||
        state.step === 'error') && <CsvDropZone accounts={accounts} />}

      {state.step === 'selecting' && <CsvSelecting accounts={accounts} />}

      {state.step === 'processing' && <CsvProcessing />}

      {state.step === 'completed' && (
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
      )}
    </div>
  )
}
