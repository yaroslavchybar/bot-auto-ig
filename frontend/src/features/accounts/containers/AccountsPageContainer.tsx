import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDataUploader } from '../hooks/useDataUploader'
import type { ScrapingTaskFieldsResponse, ScrapingTaskRow } from '../types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AmbientGlow } from '@/components/ui/ambient-glow'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import {
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Upload,
} from 'lucide-react'

const DEFAULT_ACCOUNTS_ENV = 'dev' as const
const DEFAULT_PROCESS_ENVIRONMENTS = ['dev']
const USERNAME_ALIASES = [
  'user_name',
  'userName',
  'username',
  'login',
  'User Name',
]
const FULLNAME_ALIASES = ['full_name', 'fullName', 'name']

type AccountsMode = 'csv' | 'scraping'

interface ProcessingSummary {
  stats: {
    totalProcessed: number
    removed: number
    remaining: number
  }
  uploaded: Record<string, number>
  duplicates: Record<string, number>
}

function findAlias(fields: string[], aliases: string[]) {
  return aliases.find((alias) => fields.includes(alias)) ?? null
}

function formatDate(value?: number) {
  if (typeof value !== 'number') return '-'
  return new Date(value).toLocaleString()
}

function sumRecordValues(value: Record<string, number>) {
  return Object.values(value).reduce((sum, count) => sum + count, 0)
}

function buildPreviewFields(
  fields: string[],
  sampleRow: Record<string, string>,
  detectedUsernameField: string | null,
  detectedFullNameField: string | null,
) {
  const ordered = [
    detectedUsernameField,
    detectedFullNameField,
    ...fields,
    ...Object.keys(sampleRow),
  ].filter(Boolean) as string[]

  const unique: string[] = []
  for (const field of ordered) {
    if (!unique.includes(field)) unique.push(field)
  }

  return unique.slice(0, 6)
}

function StatusBanner({
  tone,
  children,
}: {
  tone: 'danger' | 'warning' | 'success'
  children: React.ReactNode
}) {
  const className =
    tone === 'danger'
      ? 'status-banner-danger'
      : tone === 'warning'
        ? 'border-status-warning-border bg-status-warning-soft text-status-warning'
        : 'border-status-success-border bg-status-success-soft text-status-success'

  const dotClassName =
    tone === 'danger'
      ? 'status-dot-danger'
      : tone === 'warning'
        ? 'bg-status-warning'
        : 'status-dot-success-tight'

  return (
    <div
      className={cn(
        'flex items-center gap-2 border px-4 py-3 text-sm',
        tone === 'danger' && 'border-y border-x-0',
        tone !== 'danger' && 'rounded-xl',
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dotClassName)} />
      <span>{children}</span>
    </div>
  )
}

function MetricCard({
  label,
  value,
  accent = 'default',
}: {
  label: string
  value: string
  accent?: 'default' | 'danger' | 'success'
}) {
  const accentClassName =
    accent === 'danger'
      ? 'text-status-danger'
      : accent === 'success'
        ? 'text-status-success'
        : 'text-ink'

  return (
    <div className="bg-panel-strong border-line rounded-2xl border p-4">
      <div className="text-subtle-copy text-[11px] font-semibold tracking-[0.18em] uppercase">
        {label}
      </div>
      <div className={cn('mt-2 text-2xl font-semibold', accentClassName)}>
        {value}
      </div>
    </div>
  )
}

function SamplePreview({
  fields,
  sampleRow,
  detectedUsernameField,
  detectedFullNameField,
  emptyMessage,
}: {
  fields: string[]
  sampleRow: Record<string, string>
  detectedUsernameField: string | null
  detectedFullNameField: string | null
  emptyMessage: string
}) {
  if (fields.length === 0) {
    return (
      <div className="text-subtle-copy rounded-xl border border-dashed px-4 py-6 text-sm">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="bg-panel-subtle border-line-soft overflow-hidden rounded-2xl border">
      <Table>
        <TableHeader>
          <TableRow className="border-line-soft bg-transparent hover:bg-transparent">
            {fields.map((field) => {
              const isDetected =
                field === detectedUsernameField || field === detectedFullNameField

              return (
                <TableHead
                  key={field}
                  className={cn(
                    'text-muted-copy h-11 font-medium',
                    isDetected && 'text-ink',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span>{field}</span>
                    {field === detectedUsernameField ? (
                      <Badge className="brand-surface brand-text-soft border px-2 py-0 text-[10px]">
                        Username
                      </Badge>
                    ) : null}
                    {field === detectedFullNameField ? (
                      <Badge
                        variant="outline"
                        className="border-line bg-panel-muted text-copy px-2 py-0 text-[10px]"
                      >
                        Full name
                      </Badge>
                    ) : null}
                  </div>
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="border-line-soft hover:bg-transparent">
            {fields.map((field) => (
              <TableCell
                key={field}
                className="text-copy max-w-[180px] truncate font-mono text-xs"
                title={sampleRow[field] || '-'}
              >
                {sampleRow[field] || (
                  <span className="text-subtle-copy">-</span>
                )}
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}

function ProcessingResultPanel({
  title,
  summary,
  actionLabel,
  onReset,
}: {
  title: string
  summary: ProcessingSummary
  actionLabel: string
  onReset: () => void
}) {
  return (
    <div className="bg-panel-subtle border-line-soft rounded-3xl border p-5 shadow-xs backdrop-blur-xs">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-status-success flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" />
            <h3 className="text-lg font-semibold">{title}</h3>
          </div>
          <p className="text-subtle-copy mt-1 text-sm">
            Review the result and continue with the next import.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onReset}
          className="border-line text-copy hover:bg-panel-hover bg-transparent"
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          {actionLabel}
        </Button>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-5">
        <MetricCard
          label="Processed"
          value={summary.stats.totalProcessed.toLocaleString()}
        />
        <MetricCard
          label="Filtered"
          value={summary.stats.removed.toLocaleString()}
          accent="danger"
        />
        <MetricCard
          label="Kept"
          value={summary.stats.remaining.toLocaleString()}
          accent="success"
        />
        <MetricCard
          label="Inserted"
          value={sumRecordValues(summary.uploaded).toLocaleString()}
        />
        <MetricCard
          label="Duplicates"
          value={sumRecordValues(summary.duplicates).toLocaleString()}
        />
      </div>
    </div>
  )
}

export function AccountsPageContainer() {
  const isMobile = useIsMobile()
  const {
    state,
    uploadFile,
    processFile,
    reset,
    listScrapingTasks,
    getScrapingTaskFields,
    processScrapingTask,
  } = useDataUploader()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [activeMode, setActiveMode] = useState<AccountsMode>('csv')
  const [dragActive, setDragActive] = useState(false)
  const [taskSearchQuery, setTaskSearchQuery] = useState('')
  const [tasksKind, setTasksKind] = useState<'followers' | 'following' | ''>('')
  const [scrapingTasks, setScrapingTasks] = useState<ScrapingTaskRow[]>([])
  const [scrapingLoading, setScrapingLoading] = useState(false)
  const [scrapingError, setScrapingError] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [selectedTaskPreview, setSelectedTaskPreview] =
    useState<ScrapingTaskFieldsResponse | null>(null)
  const [selectedTaskLoading, setSelectedTaskLoading] = useState(false)
  const [selectedTaskError, setSelectedTaskError] = useState<string | null>(null)
  const [processingTaskId, setProcessingTaskId] = useState<string | null>(null)
  const [scrapingResult, setScrapingResult] = useState<ProcessingSummary | null>(
    null,
  )

  const refreshScrapingTasks = useCallback(async () => {
    setScrapingLoading(true)
    setScrapingError(null)
    try {
      const tasks = await listScrapingTasks(
        DEFAULT_ACCOUNTS_ENV,
        tasksKind || undefined,
      )
      setScrapingTasks(tasks)
    } catch (error) {
      setScrapingTasks([])
      setScrapingError(error instanceof Error ? error.message : String(error))
    } finally {
      setScrapingLoading(false)
    }
  }, [listScrapingTasks, tasksKind])

  useEffect(() => {
    void refreshScrapingTasks()
  }, [refreshScrapingTasks])

  useEffect(() => {
    if (!selectedTaskId) return

    const stillExists = scrapingTasks.some(
      (task) => String(task._id || '') === selectedTaskId,
    )

    if (!stillExists) {
      setSelectedTaskId(null)
      setSelectedTaskPreview(null)
      setSelectedTaskError(null)
    }
  }, [scrapingTasks, selectedTaskId])

  const filteredScrapingTasks = useMemo(() => {
    const query = taskSearchQuery.trim().toLowerCase()
    if (!query) return scrapingTasks

    return scrapingTasks.filter((task) => {
      const fields = [
        task.name,
        task.kind,
        task.targetUsername,
        task.status,
        formatDate(task.createdAt),
      ]

      return fields.some((field) =>
        String(field ?? '')
          .toLowerCase()
          .includes(query),
      )
    })
  }, [scrapingTasks, taskSearchQuery])

  const selectedTask = useMemo(
    () =>
      scrapingTasks.find((task) => String(task._id || '') === selectedTaskId) ??
      null,
    [scrapingTasks, selectedTaskId],
  )

  const csvDetectedUsernameField =
    state.step === 'selecting' ? findAlias(state.fields, USERNAME_ALIASES) : null
  const csvDetectedFullNameField =
    state.step === 'selecting' ? findAlias(state.fields, FULLNAME_ALIASES) : null
  const csvPreviewFields =
    state.step === 'selecting'
      ? buildPreviewFields(
          state.fields,
          state.sampleRow,
          csvDetectedUsernameField,
          csvDetectedFullNameField,
        )
      : []
  const csvMissingUsername =
    state.step === 'selecting' && !csvDetectedUsernameField

  const selectedTaskDetectedUsernameField = selectedTaskPreview
    ? findAlias(selectedTaskPreview.fields, USERNAME_ALIASES)
    : null
  const selectedTaskDetectedFullNameField = selectedTaskPreview
    ? findAlias(selectedTaskPreview.fields, FULLNAME_ALIASES)
    : null
  const selectedTaskPreviewFields = selectedTaskPreview
    ? buildPreviewFields(
        selectedTaskPreview.fields,
        selectedTaskPreview.sampleRow,
        selectedTaskDetectedUsernameField,
        selectedTaskDetectedFullNameField,
      )
    : []
  const selectedTaskMissingUsername =
    selectedTaskPreview !== null && !selectedTaskDetectedUsernameField

  const isCsvBusy = state.step === 'uploading' || state.step === 'processing'
  const isScrapingBusy =
    scrapingLoading || selectedTaskLoading || Boolean(processingTaskId)

  const csvDirty = state.step !== 'idle'
  const scrapingDirty =
    Boolean(selectedTaskId) ||
    Boolean(scrapingResult) ||
    taskSearchQuery.trim().length > 0 ||
    tasksKind !== ''

  const handleCsvReset = useCallback(() => {
    reset()
    setDragActive(false)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [reset])

  const handleScrapingReset = useCallback(() => {
    setTaskSearchQuery('')
    setTasksKind('')
    setSelectedTaskId(null)
    setSelectedTaskPreview(null)
    setSelectedTaskError(null)
    setScrapingResult(null)
  }, [])

  const handleResetActiveMode = useCallback(() => {
    if (activeMode === 'csv') {
      handleCsvReset()
      return
    }

    handleScrapingReset()
  }, [activeMode, handleCsvReset, handleScrapingReset])

  const handleDrag = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.type === 'dragenter' || event.type === 'dragover') {
      setDragActive(true)
    } else if (event.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleUploadFile = useCallback(
    async (file: File) => {
      setDragActive(false)
      await uploadFile(file)
    },
    [uploadFile],
  )

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      event.stopPropagation()
      setDragActive(false)

      const file = event.dataTransfer.files?.[0]
      if (file?.name.toLowerCase().endsWith('.csv')) {
        void handleUploadFile(file)
      }
    },
    [handleUploadFile],
  )

  const handleFileSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (file) {
        void handleUploadFile(file)
      }
    },
    [handleUploadFile],
  )

  const handleProcessCsv = useCallback(() => {
    if (state.step !== 'selecting' || csvMissingUsername) return

    void processFile(
      state.jobId,
      state.fields,
      true,
      DEFAULT_PROCESS_ENVIRONMENTS,
    )
  }, [csvMissingUsername, processFile, state])

  const handleSelectTask = useCallback(
    async (taskId: string) => {
      if (!taskId || selectedTaskLoading) return

      setSelectedTaskId(taskId)
      setSelectedTaskError(null)
      setScrapingResult(null)
      setSelectedTaskLoading(true)

      try {
        const preview = await getScrapingTaskFields(taskId, DEFAULT_ACCOUNTS_ENV)
        setSelectedTaskPreview(preview)
      } catch (error) {
        setSelectedTaskPreview(null)
        setSelectedTaskError(error instanceof Error ? error.message : String(error))
      } finally {
        setSelectedTaskLoading(false)
      }
    },
    [getScrapingTaskFields, selectedTaskLoading],
  )

  const handleProcessTask = useCallback(async () => {
    if (!selectedTaskId || !selectedTaskPreview || selectedTaskMissingUsername) {
      return
    }

    setProcessingTaskId(selectedTaskId)
    setSelectedTaskError(null)
    try {
      const result = await processScrapingTask(selectedTaskId, {
        env: DEFAULT_ACCOUNTS_ENV,
        keepFields: selectedTaskPreview.fields,
        uploadToConvex: true,
        environments: DEFAULT_PROCESS_ENVIRONMENTS,
        accountStatus: 'available',
      })
      setScrapingResult({
        stats: result.stats,
        uploaded: result.uploaded,
        duplicates: result.duplicates,
      })
      await refreshScrapingTasks()
    } catch (error) {
      setSelectedTaskError(error instanceof Error ? error.message : String(error))
    } finally {
      setProcessingTaskId(null)
    }
  }, [
    processScrapingTask,
    refreshScrapingTasks,
    selectedTaskId,
    selectedTaskMissingUsername,
    selectedTaskPreview,
  ])

  return (
    <div className="bg-shell text-ink animate-in fade-in relative flex h-full flex-col duration-300">
      <AmbientGlow />

      <Tabs
        value={activeMode}
        onValueChange={(value) => setActiveMode(value as AccountsMode)}
        className="flex h-full flex-col"
      >
        <div className="mobile-effect-blur mobile-effect-sticky border-line-soft bg-panel-subtle sticky top-0 z-10 border-b backdrop-blur-xs">
          <div className="flex flex-col gap-4 px-4 py-4 md:px-6 xl:flex-row xl:items-center xl:justify-between xl:gap-6">
            <div className="min-w-0">
              <h2 className="page-title-gradient text-3xl font-extrabold tracking-tight">
                Upload Accounts
              </h2>
              <p className="text-subtle-copy mt-1 text-sm">
                Import cleaned Instagram account sources without leaving the
                operations workspace.
              </p>
            </div>

            <div className="flex flex-col gap-2 xl:items-end">
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
                  Scraping Import
                </TabsTrigger>
              </TabsList>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                {activeMode === 'scraping' ? (
                  <Button
                    variant="outline"
                    size={isMobile ? 'default' : 'sm'}
                    onClick={() => void refreshScrapingTasks()}
                    disabled={isScrapingBusy}
                    className="border-line text-copy hover:bg-panel-hover bg-transparent"
                  >
                    <RefreshCw
                      className={cn(
                        isMobile ? 'h-4 w-4' : 'mr-2 h-3.5 w-3.5',
                        scrapingLoading && 'animate-spin',
                      )}
                    />
                    <span>Refresh</span>
                  </Button>
                ) : null}

                {((activeMode === 'csv' && csvDirty) ||
                  (activeMode === 'scraping' && scrapingDirty)) && (
                  <Button
                    variant="outline"
                    size={isMobile ? 'default' : 'sm'}
                    onClick={handleResetActiveMode}
                    disabled={activeMode === 'csv' ? isCsvBusy : isScrapingBusy}
                    className="border-line text-copy hover:bg-panel-hover bg-transparent"
                  >
                    <RotateCcw
                      className={isMobile ? 'h-4 w-4' : 'mr-2 h-3.5 w-3.5'}
                    />
                    <span>Start over</span>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {activeMode === 'csv' && state.step === 'error' ? (
          <StatusBanner tone="danger">{state.message}</StatusBanner>
        ) : null}

        <div className="flex-1 overflow-auto p-4 md:p-6">
          <div className="mx-auto max-w-[2000px]">
            <TabsContent value="csv" className="mt-0 outline-none">
              <div className="space-y-4">
                {(state.step === 'idle' ||
                  state.step === 'uploading' ||
                  state.step === 'error') && (
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
                          <h3 className="mt-4 text-xl font-semibold">
                            Uploading file
                          </h3>
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
                            The uploader will detect the username and optional
                            full-name columns automatically, then send the
                            cleaned results into the account pipeline.
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
                )}
                {state.step === 'selecting' && (
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(360px,0.9fr)]">
                    <div className="space-y-4">
                      {csvMissingUsername ? (
                        <StatusBanner tone="warning">
                          No supported username column was detected. Add one of:{' '}
                          {USERNAME_ALIASES.join(', ')}.
                        </StatusBanner>
                      ) : (
                        <StatusBanner tone="success">
                          Username column detected automatically. Review the
                          preview and process the upload.
                        </StatusBanner>
                      )}

                      <div className="bg-panel-subtle border-line-soft rounded-3xl border p-5 shadow-xs backdrop-blur-xs">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <h3 className="text-xl font-semibold">Detected Data</h3>
                            <p className="text-subtle-copy mt-1 text-sm">
                              The uploader is using backend alias rules to infer
                              the account fields before processing.
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
                          <MetricCard
                            label="Rows"
                            value={state.rowCount.toLocaleString()}
                          />
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
                    </div>

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
                        onClick={handleProcessCsv}
                        disabled={csvMissingUsername}
                        className="brand-button mt-5 h-11 w-full"
                      >
                        Process & Upload
                      </Button>
                    </div>
                  </div>
                )}

                {state.step === 'processing' && (
                  <div className="bg-panel-subtle border-line-soft rounded-3xl border p-8 shadow-xs backdrop-blur-xs">
                    <div className="flex flex-col items-center justify-center text-center">
                      <Loader2 className="text-brand h-10 w-10 animate-spin" />
                      <h3 className="mt-4 text-xl font-semibold">Processing upload</h3>
                      <p className="text-subtle-copy mt-2 text-sm">
                        Filtering accounts, removing duplicates, and uploading
                        the cleaned result.
                      </p>
                    </div>
                  </div>
                )}

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
            </TabsContent>

            <TabsContent value="scraping" className="mt-0 outline-none">
              <div className="space-y-4">
                {scrapingError ? (
                  <StatusBanner tone="danger">{scrapingError}</StatusBanner>
                ) : null}

                <div className="bg-panel-subtle border-line-soft rounded-3xl border p-4 shadow-xs backdrop-blur-xs">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="relative w-full xl:max-w-xl xl:flex-1">
                      <Search className="text-subtle-copy pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                      <Input
                        value={taskSearchQuery}
                        onChange={(event) => setTaskSearchQuery(event.target.value)}
                        placeholder="Search scraping tasks..."
                        className="brand-focus brand-focus-strong border-line bg-panel-strong text-inverse placeholder:text-subtle-copy h-11 rounded-xl pl-10"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant={tasksKind === '' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setTasksKind('')}
                        className={cn(
                          tasksKind === ''
                            ? 'brand-button'
                            : 'border-line text-copy hover:bg-panel-hover bg-transparent',
                        )}
                      >
                        All
                      </Button>
                      <Button
                        variant={tasksKind === 'followers' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setTasksKind('followers')}
                        className={cn(
                          tasksKind === 'followers'
                            ? 'brand-button'
                            : 'border-line text-copy hover:bg-panel-hover bg-transparent',
                        )}
                      >
                        Followers
                      </Button>
                      <Button
                        variant={tasksKind === 'following' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setTasksKind('following')}
                        className={cn(
                          tasksKind === 'following'
                            ? 'brand-button'
                            : 'border-line text-copy hover:bg-panel-hover bg-transparent',
                        )}
                      >
                        Following
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.95fr)]">
                  <div className="bg-panel-subtle border-line-soft overflow-hidden rounded-3xl border shadow-xs backdrop-blur-xs">
                    {scrapingLoading ? (
                      <div className="flex items-center justify-center px-6 py-12 text-sm">
                        <Loader2 className="text-brand mr-2 h-4 w-4 animate-spin" />
                        Loading tasks...
                      </div>
                    ) : filteredScrapingTasks.length === 0 ? (
                      <div className="flex flex-col items-center justify-center p-12 text-center">
                        <FileSpreadsheet className="text-subtle-copy mb-4 h-10 w-10" />
                        <h3 className="text-lg font-medium">
                          {taskSearchQuery.trim()
                            ? 'No matching tasks'
                            : 'No scraping tasks ready'}
                        </h3>
                        <p className="text-subtle-copy mt-1 text-sm">
                          {taskSearchQuery.trim()
                            ? 'Try a different query or clear the filter.'
                            : 'Completed unimported tasks will appear here.'}
                        </p>
                      </div>
                    ) : isMobile ? (
                      <div className="space-y-3 p-3">
                        {filteredScrapingTasks.map((task) => {
                          const taskId = String(task._id || '')
                          const isSelected = taskId === selectedTaskId
                          return (
                            <button
                              key={taskId}
                              type="button"
                              onClick={() => void handleSelectTask(taskId)}
                              className={cn(
                                'bg-panel-strong border-line hover:border-line-strong w-full rounded-2xl border p-4 text-left transition-colors',
                                isSelected && 'border-brand',
                              )}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-ink truncate font-semibold">
                                    {task.name || 'Untitled task'}
                                  </div>
                                  <div className="text-subtle-copy mt-1 text-xs">
                                    {formatDate(task.createdAt)}
                                  </div>
                                </div>
                                <Badge
                                  variant="outline"
                                  className="border-line bg-panel-muted text-copy"
                                >
                                  {task.kind || '-'}
                                </Badge>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow className="border-line-soft border-b bg-transparent hover:bg-transparent">
                            <TableHead className="text-muted-copy h-12 pl-4 font-medium">
                              Task
                            </TableHead>
                            <TableHead className="text-muted-copy h-12 font-medium">
                              Kind
                            </TableHead>
                            <TableHead className="text-muted-copy h-12 font-medium">
                              Status
                            </TableHead>
                            <TableHead className="text-muted-copy h-12 pr-4 font-medium">
                              Created
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredScrapingTasks.map((task) => {
                            const taskId = String(task._id || '')
                            const isSelected = taskId === selectedTaskId
                            return (
                              <TableRow
                                key={taskId}
                                onClick={() => void handleSelectTask(taskId)}
                                className={cn(
                                  'group border-line-soft cursor-pointer border-b transition-colors hover:bg-panel-subtle',
                                  isSelected && 'bg-panel-subtle',
                                )}
                              >
                                <TableCell className="pl-4">
                                  <div className="flex flex-col gap-0.5">
                                    <span className="text-ink truncate font-medium">
                                      {task.name || 'Untitled task'}
                                    </span>
                                    <span className="text-subtle-copy max-w-[320px] truncate text-[11px]">
                                      {task.targetUsername || '-'}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant="outline"
                                    className="border-line bg-panel-muted text-copy"
                                  >
                                    {task.kind || '-'}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <span className="text-copy text-sm">
                                    {task.status || 'completed'}
                                  </span>
                                </TableCell>
                                <TableCell className="pr-4 text-sm text-muted-foreground">
                                  {formatDate(task.createdAt)}
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </div>

                  <div className="bg-panel-subtle border-line-soft h-fit rounded-3xl border p-5 shadow-xs backdrop-blur-xs xl:sticky xl:top-28">
                    <div className="flex items-center gap-2">
                      <div className="brand-surface brand-text flex h-10 w-10 items-center justify-center rounded-xl border">
                        <FileSpreadsheet className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold">Task details</h3>
                        <p className="text-subtle-copy text-sm">
                          Select a completed scraping task to review and import.
                        </p>
                      </div>
                    </div>

                    {selectedTaskError ? (
                      <div className="mt-5">
                        <StatusBanner tone="danger">{selectedTaskError}</StatusBanner>
                      </div>
                    ) : null}

                    {selectedTaskLoading ? (
                      <div className="flex items-center justify-center px-4 py-10 text-sm">
                        <Loader2 className="text-brand mr-2 h-4 w-4 animate-spin" />
                        Loading task preview...
                      </div>
                    ) : !selectedTask || !selectedTaskPreview ? (
                      <div className="text-subtle-copy border-line mt-5 rounded-2xl border border-dashed px-4 py-10 text-center text-sm">
                        Pick a task from the list to inspect the detected account
                        data before importing.
                      </div>
                    ) : (
                      <div className="mt-5 space-y-5">
                        {scrapingResult ? (
                          <ProcessingResultPanel
                            title="Scraping import complete"
                            summary={scrapingResult}
                            actionLabel="Import another task"
                            onReset={handleScrapingReset}
                          />
                        ) : null}

                        {selectedTaskMissingUsername ? (
                          <StatusBanner tone="warning">
                            This task does not expose a supported username field.
                            Expected one of: {USERNAME_ALIASES.join(', ')}.
                          </StatusBanner>
                        ) : null}

                        <div className="bg-panel-strong border-line rounded-2xl border p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-ink truncate text-lg font-semibold">
                                {selectedTask.name || 'Untitled task'}
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
                              value={
                                selectedTaskDetectedUsernameField ?? 'Missing'
                              }
                              accent={
                                selectedTaskDetectedUsernameField
                                  ? 'success'
                                  : 'danger'
                              }
                            />
                            <MetricCard
                              label="Full Name Source"
                              value={
                                selectedTaskDetectedFullNameField ?? 'Not detected'
                              }
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
                            emptyMessage="No sample data is available for this task."
                          />
                        </div>

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
                            'Process & Upload'
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>
          </div>
        </div>
      </Tabs>
    </div>
  )
}




