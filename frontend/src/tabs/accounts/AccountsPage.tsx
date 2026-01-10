import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDataUploader } from './useDataUploader'
import type { ScrapingTaskRow } from './types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
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
import {
  FileSpreadsheet,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Database,
  Filter,
  Search,
  Check,
  RefreshCw,
  Download,
} from 'lucide-react'

export function AccountsPage() {
  const { state, uploadFile, processFile, reset, listScrapingTasks, getScrapingTaskFields, processScrapingTask } = useDataUploader()
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set())
  const [uploadToConvex, setUploadToConvex] = useState(true)
  const [environments, setEnvironments] = useState<Set<string>>(new Set(['dev']))
  const [dragActive, setDragActive] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [tasksEnv, setTasksEnv] = useState<'dev' | 'prod'>('dev')
  const [tasksKind, setTasksKind] = useState<'followers' | 'following' | ''>('')
  const [scrapingTasks, setScrapingTasks] = useState<ScrapingTaskRow[]>([])
  const [scrapingLoading, setScrapingLoading] = useState(false)
  const [scrapingError, setScrapingError] = useState<string | null>(null)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<{
    taskId: string
    env: string
    usernamesExtracted: number
    stats: { totalProcessed: number; removed: number; remaining: number }
    uploaded: Record<string, number>
    duplicates: Record<string, number>
  } | null>(null)
  const [importStep, setImportStep] = useState<'idle' | 'selecting' | 'processing'>('idle')
  const [importTaskId, setImportTaskId] = useState<string | null>(null)
  const [importTaskName, setImportTaskName] = useState<string>('')
  const [importFields, setImportFields] = useState<string[]>([])
  const [importSampleRow, setImportSampleRow] = useState<Record<string, string>>({})
  const [importRowCount, setImportRowCount] = useState<number>(0)
  const [importSelectedFields, setImportSelectedFields] = useState<Set<string>>(new Set())
  const [importSearchQuery, setImportSearchQuery] = useState('')
  const [importUploadToConvex, setImportUploadToConvex] = useState(true)
  const [importEnvironments, setImportEnvironments] = useState<Set<string>>(new Set(['dev']))

  const filteredFields = useMemo(() => {
    if (state.step !== 'selecting') return []
    if (!searchQuery.trim()) return state.fields
    return state.fields.filter(f =>
      f.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [state, searchQuery])

  const filteredImportFields = useMemo(() => {
    if (importStep !== 'selecting') return []
    if (!importSearchQuery.trim()) return importFields
    return importFields.filter(f =>
      f.toLowerCase().includes(importSearchQuery.toLowerCase())
    )
  }, [importFields, importSearchQuery, importStep])

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    const files = e.dataTransfer.files
    if (files?.[0]?.name.endsWith('.csv')) {
      void uploadFile(files[0])
    }
  }, [uploadFile])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files?.[0]) {
      void uploadFile(files[0])
    }
  }, [uploadFile])

  const handleFieldToggle = useCallback((field: string) => {
    setSelectedFields(prev => {
      const next = new Set(prev)
      if (next.has(field)) {
        next.delete(field)
      } else {
        next.add(field)
      }
      return next
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    if (state.step === 'selecting') {
      setSelectedFields(new Set(state.fields))
    }
  }, [state])

  const handleSelectNone = useCallback(() => {
    setSelectedFields(new Set())
  }, [])

  const handleEnvToggle = useCallback((env: string) => {
    setEnvironments(prev => {
      const next = new Set(prev)
      if (next.has(env)) {
        next.delete(env)
      } else {
        next.add(env)
      }
      return next
    })
  }, [])

  const handleProcess = useCallback(() => {
    if (state.step === 'selecting' && selectedFields.size > 0) {
      void processFile(
        state.jobId,
        Array.from(selectedFields),
        uploadToConvex,
        Array.from(environments)
      )
    }
  }, [state, selectedFields, uploadToConvex, environments, processFile])

  const handleImportFieldToggle = useCallback((field: string) => {
    setImportSelectedFields(prev => {
      const next = new Set(prev)
      if (next.has(field)) {
        next.delete(field)
      } else {
        next.add(field)
      }
      return next
    })
  }, [])

  const handleImportSelectAll = useCallback(() => {
    if (importStep === 'selecting') {
      setImportSelectedFields(new Set(importFields))
    }
  }, [importFields, importStep])

  const handleImportSelectNone = useCallback(() => {
    setImportSelectedFields(new Set())
  }, [])

  const handleImportEnvToggle = useCallback((env: string) => {
    setImportEnvironments(prev => {
      const next = new Set(prev)
      if (next.has(env)) {
        next.delete(env)
      } else {
        next.add(env)
      }
      return next
    })
  }, [])

  const resetImportFlow = useCallback(() => {
    setImportStep('idle')
    setImportTaskId(null)
    setImportTaskName('')
    setImportFields([])
    setImportSampleRow({})
    setImportRowCount(0)
    setImportSelectedFields(new Set())
    setImportSearchQuery('')
    setImportUploadToConvex(true)
    setImportEnvironments(new Set(['dev']))
    setImportResult(null)
  }, [])

  const refreshScrapingTasks = useCallback(async () => {
    setScrapingLoading(true)
    setScrapingError(null)
    try {
      const tasks = await listScrapingTasks(tasksEnv, tasksKind || undefined)
      setScrapingTasks(tasks)
    } catch (e) {
      setScrapingTasks([])
      setScrapingError(e instanceof Error ? e.message : String(e))
    } finally {
      setScrapingLoading(false)
    }
  }, [listScrapingTasks, tasksEnv, tasksKind])

  useEffect(() => {
    void refreshScrapingTasks()
  }, [refreshScrapingTasks])

  const handleImportTask = useCallback(
    async (taskId: string) => {
      if (importingId) return
      setImportingId(taskId)
      setImportResult(null)
      setScrapingError(null)
      try {
        const found = scrapingTasks.find(t => String(t._id || '') === taskId)
        const fieldsRes = await getScrapingTaskFields(taskId, tasksEnv)
        setImportTaskId(taskId)
        setImportTaskName(String(found?.name || ''))
        setImportFields(fieldsRes.fields || [])
        setImportSampleRow(fieldsRes.sampleRow || {})
        setImportRowCount(typeof fieldsRes.rowCount === 'number' ? fieldsRes.rowCount : 0)

        const prefer = ['userName', 'username', 'user_name', 'login', 'User Name', 'fullName', 'full_name', 'name']
        const preferredFields = prefer.filter(f => (fieldsRes.fields || []).includes(f))
        setImportSelectedFields(new Set(preferredFields))
        setImportStep('selecting')
      } catch (e) {
        setScrapingError(e instanceof Error ? e.message : String(e))
      } finally {
        setImportingId(null)
      }
    },
    [getScrapingTaskFields, importingId, scrapingTasks, tasksEnv]
  )

  const handleImportProcess = useCallback(async () => {
    if (importStep !== 'selecting') return
    if (!importTaskId) return
    if (importSelectedFields.size === 0) return

    setImportStep('processing')
    setImportResult(null)
    setScrapingError(null)
    try {
      const res = await processScrapingTask(importTaskId, {
        env: tasksEnv,
        keepFields: Array.from(importSelectedFields),
        uploadToConvex: importUploadToConvex,
        environments: Array.from(importEnvironments),
        accountStatus: 'available',
      })
      setImportResult({
        taskId: res.taskId,
        env: res.env,
        usernamesExtracted: res.usernamesExtracted,
        stats: res.stats,
        uploaded: res.uploaded,
        duplicates: res.duplicates,
      })
      setImportStep('idle')
      await refreshScrapingTasks()
    } catch (e) {
      setScrapingError(e instanceof Error ? e.message : String(e))
      setImportStep('selecting')
    }
  }, [importEnvironments, importSelectedFields, importStep, importTaskId, importUploadToConvex, processScrapingTask, refreshScrapingTasks, tasksEnv])

  const handleReset = useCallback(() => {
    reset()
    setSelectedFields(new Set())
    setEnvironments(new Set(['dev']))
    setSearchQuery('')
    resetImportFlow()
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [reset, resetImportFlow])

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-2xl font-bold tracking-tight">Upload Accounts</h2>
        {(state.step !== 'idle' && state.step !== 'uploading') || importStep !== 'idle' || Boolean(importResult) ? (
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Start Over
          </Button>
        ) : null}
      </div>

      {/* Error display */}
      {state.step === 'error' && (
        <div className="p-3 bg-destructive/10 text-destructive text-sm border-b border-destructive/20">
          {state.message}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-auto p-4 bg-muted/10">
        <div className="max-w-4xl mx-auto space-y-3">

          <Card>
            <CardHeader className="p-3 pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">Import From Scraping Tasks</CardTitle>
                <Button variant="outline" size="sm" className="h-8" onClick={() => void refreshScrapingTasks()} disabled={scrapingLoading || Boolean(importingId)}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${scrapingLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-3 pt-0 space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Env</span>
                  <Button
                    variant={tasksEnv === 'dev' ? 'default' : 'outline'}
                    size="sm"
                    className="h-8"
                    onClick={() => setTasksEnv('dev')}
                    disabled={scrapingLoading || Boolean(importingId)}
                  >
                    Dev
                  </Button>
                  <Button
                    variant={tasksEnv === 'prod' ? 'default' : 'outline'}
                    size="sm"
                    className="h-8"
                    onClick={() => setTasksEnv('prod')}
                    disabled={scrapingLoading || Boolean(importingId)}
                  >
                    Prod
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Kind</span>
                  <Button
                    variant={tasksKind === '' ? 'default' : 'outline'}
                    size="sm"
                    className="h-8"
                    onClick={() => setTasksKind('')}
                    disabled={scrapingLoading || Boolean(importingId)}
                  >
                    All
                  </Button>
                  <Button
                    variant={tasksKind === 'followers' ? 'default' : 'outline'}
                    size="sm"
                    className="h-8"
                    onClick={() => setTasksKind('followers')}
                    disabled={scrapingLoading || Boolean(importingId)}
                  >
                    Followers
                  </Button>
                  <Button
                    variant={tasksKind === 'following' ? 'default' : 'outline'}
                    size="sm"
                    className="h-8"
                    onClick={() => setTasksKind('following')}
                    disabled={scrapingLoading || Boolean(importingId)}
                  >
                    Following
                  </Button>
                </div>
              </div>

              {scrapingError && (
                <div className="p-2 rounded border bg-destructive/10 text-destructive text-sm">
                  {scrapingError}
                </div>
              )}

              {importResult && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="secondary" className="text-xs">
                    {importResult.stats.totalProcessed.toLocaleString()} processed
                  </Badge>
                  <Badge variant="outline" className="text-xs text-amber-600 border-amber-600/30">
                    {importResult.stats.removed.toLocaleString()} filtered
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    {importResult.usernamesExtracted.toLocaleString()} usernames
                  </Badge>
                  {Object.keys(importResult.uploaded).map((env) => {
                    const inserted = importResult.uploaded[env] || 0
                    const dupes = importResult.duplicates[env] || 0
                    return (
                      <Badge key={env} variant="secondary" className="text-xs">
                        {env}: {inserted.toLocaleString()} inserted{dupes > 0 ? `, ${dupes.toLocaleString()} dupes` : ''}
                      </Badge>
                    )
                  })}
                </div>
              )}

              <div className="rounded border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="h-8">
                      <TableHead className="text-xs">Name</TableHead>
                      <TableHead className="text-xs">Kind</TableHead>
                      <TableHead className="text-xs">Created</TableHead>
                      <TableHead className="text-xs text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scrapingLoading ? (
                      <TableRow className="h-10">
                        <TableCell colSpan={4} className="text-sm text-muted-foreground">
                          Loading...
                        </TableCell>
                      </TableRow>
                    ) : scrapingTasks.length === 0 ? (
                      <TableRow className="h-10">
                        <TableCell colSpan={4} className="text-sm text-muted-foreground">
                          No unimported completed tasks found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      scrapingTasks.map((t) => {
                        const id = String(t._id || '')
                        const createdAt = typeof t.createdAt === 'number' ? new Date(t.createdAt).toLocaleString() : '—'
                        return (
                          <TableRow key={id} className="h-10">
                            <TableCell className="text-sm font-medium">{String(t.name || '—')}</TableCell>
                            <TableCell className="text-sm">
                              <Badge variant="outline" className="text-xs">
                                {String(t.kind || '—')}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{createdAt}</TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                onClick={() => void handleImportTask(id)}
                                disabled={!id || Boolean(importingId) || importStep === 'processing'}
                              >
                                {importingId === id ? (
                                  <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Loading
                                  </>
                                ) : (
                                  <>
                                    <Download className="mr-2 h-4 w-4" />
                                    Import
                                  </>
                                )}
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {importStep !== 'idle' && importTaskId && (
                <>
                  <Card className="mt-2">
                    <CardContent className="p-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Download className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{importTaskName || importTaskId}</span>
                        <span className="text-sm text-muted-foreground">
                          {importRowCount.toLocaleString()} rows • {importFields.length} fields
                        </span>
                      </div>
                      <Badge variant="outline" className="text-xs">Ready</Badge>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="p-3 pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Filter className="h-4 w-4 text-muted-foreground" />
                          <CardTitle className="text-base">Choose Fields</CardTitle>
                          <Badge variant="secondary" className="text-xs">
                            {importSelectedFields.size} / {importFields.length} selected
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" className="h-8" onClick={handleImportSelectAll}>
                            Select all
                          </Button>
                          <Button variant="outline" size="sm" className="h-8" onClick={handleImportSelectNone}>
                            Select none
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-3 pt-0 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            value={importSearchQuery}
                            onChange={(e) => setImportSearchQuery(e.target.value)}
                            placeholder="Search fields..."
                            className="pl-9 h-9"
                            disabled={importStep === 'processing'}
                          />
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {filteredImportFields.length} shown
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-52 overflow-auto rounded border p-2 bg-background">
                        {filteredImportFields.map((field) => (
                          <div key={field} className="flex items-center gap-2">
                            <Checkbox
                              id={`import-field-${field}`}
                              checked={importSelectedFields.has(field)}
                              onCheckedChange={() => handleImportFieldToggle(field)}
                              disabled={importStep === 'processing'}
                            />
                            <Label htmlFor={`import-field-${field}`} className="text-sm cursor-pointer truncate">
                              {field}
                            </Label>
                          </div>
                        ))}
                      </div>

                      {importSelectedFields.size > 0 && (
                        <div className="rounded border overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow className="h-8">
                                {Array.from(importSelectedFields).map(field => (
                                  <TableHead key={field} className="text-xs whitespace-nowrap py-1.5">
                                    {field}
                                  </TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              <TableRow className="h-8">
                                {Array.from(importSelectedFields).map(field => (
                                  <TableCell key={field} className="font-mono text-xs py-1.5">
                                    {importSampleRow[field] || <span className="text-muted-foreground">—</span>}
                                  </TableCell>
                                ))}
                              </TableRow>
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-3 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <Database className="h-4 w-4 text-muted-foreground" />
                          <Checkbox
                            id="importUploadToConvex"
                            checked={importUploadToConvex}
                            onCheckedChange={(checked) => setImportUploadToConvex(checked === true)}
                            disabled={importStep === 'processing'}
                          />
                          <Label htmlFor="importUploadToConvex" className="text-sm cursor-pointer">
                            Upload to Convex
                          </Label>
                        </div>

                        {importUploadToConvex && (
                          <div className="flex items-center gap-3 text-sm">
                            <div className="flex items-center gap-1.5">
                              <Checkbox
                                id="import-env-dev"
                                checked={importEnvironments.has('dev')}
                                onCheckedChange={() => handleImportEnvToggle('dev')}
                                disabled={importStep === 'processing'}
                              />
                              <Label htmlFor="import-env-dev" className="text-sm cursor-pointer">Dev</Label>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Checkbox
                                id="import-env-prod"
                                checked={importEnvironments.has('prod')}
                                onCheckedChange={() => handleImportEnvToggle('prod')}
                                disabled={importStep === 'processing'}
                              />
                              <Label htmlFor="import-env-prod" className="text-sm cursor-pointer">Prod</Label>
                            </div>
                          </div>
                        )}
                      </div>

                      <Button
                        size="sm"
                        onClick={() => void handleImportProcess()}
                        disabled={importSelectedFields.size === 0 || (importUploadToConvex && importEnvironments.size === 0) || importStep === 'processing'}
                      >
                        {importStep === 'processing' ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Processing
                          </>
                        ) : (
                          <>
                            <Filter className="mr-2 h-4 w-4" />
                            Process & Upload
                          </>
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                </>
              )}
            </CardContent>
          </Card>

          {/* Upload Zone */}
          {(state.step === 'idle' || state.step === 'uploading' || state.step === 'error') && (
            <Card>
              <CardContent className="p-4">
                <div
                  className={`
                    border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
                    ${dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}
                    ${state.step === 'uploading' ? 'pointer-events-none opacity-50' : ''}
                  `}
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
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <p className="font-medium">Uploading...</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1">
                      <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
                      <p className="font-medium">Drop your CSV file here</p>
                      <p className="text-sm text-muted-foreground">or click to browse</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Field Selection */}
          {state.step === 'selecting' && (
            <>
              {/* File Info */}
              <Card>
                <CardContent className="p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{state.fileName}</span>
                    <span className="text-sm text-muted-foreground">
                      {state.rowCount.toLocaleString()} rows • {state.fields.length} columns
                    </span>
                  </div>
                  <Badge variant="outline" className="text-xs">Ready</Badge>
                </CardContent>
              </Card>

              {/* Field Selection */}
              <Card>
                <CardHeader className="p-3 pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Filter className="h-4 w-4" />
                      Select Fields
                    </CardTitle>
                    <Badge variant="secondary" className="text-xs">
                      {selectedFields.size} / {state.fields.length} selected
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-3 pt-0 space-y-2">
                  {/* Search and bulk actions */}
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search fields..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8 h-8 text-sm"
                      />
                    </div>
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleSelectAll}>
                      Select All
                    </Button>
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleSelectNone}>
                      Clear
                    </Button>
                  </div>

                  {/* Fields grid */}
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1.5">
                    {filteredFields.map(field => (
                      <div
                        key={field}
                        onClick={() => handleFieldToggle(field)}
                        className={`
                          flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors text-sm
                          ${selectedFields.has(field)
                            ? 'bg-primary/10 border border-primary/30'
                            : 'bg-muted/50 hover:bg-muted border border-transparent'
                          }
                        `}
                      >
                        <div className={`
                          w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0
                          ${selectedFields.has(field)
                            ? 'bg-primary text-primary-foreground'
                            : 'border border-muted-foreground/30'
                          }
                        `}>
                          {selectedFields.has(field) && <Check className="h-2.5 w-2.5" />}
                        </div>
                        <span className="truncate" title={field}>{field}</span>
                      </div>
                    ))}
                  </div>

                  {searchQuery && filteredFields.length === 0 && (
                    <p className="text-center text-sm text-muted-foreground py-2">
                      No fields match "{searchQuery}"
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Sample Preview - only show if fields selected */}
              {selectedFields.size > 0 && (
                <Card>
                  <CardHeader className="p-3 pb-2">
                    <CardTitle className="text-sm">Sample Preview</CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 pt-0">
                    <div className="rounded border overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="h-8">
                            {Array.from(selectedFields).map(field => (
                              <TableHead key={field} className="text-xs whitespace-nowrap py-1.5">
                                {field}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <TableRow className="h-8">
                            {Array.from(selectedFields).map(field => (
                              <TableCell key={field} className="font-mono text-xs py-1.5">
                                {state.sampleRow[field] || <span className="text-muted-foreground">—</span>}
                              </TableCell>
                            ))}
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Upload Options + Process Button in same row */}
              <Card>
                <CardContent className="p-3 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-muted-foreground" />
                      <Checkbox
                        id="uploadToConvex"
                        checked={uploadToConvex}
                        onCheckedChange={(checked) => setUploadToConvex(checked === true)}
                      />
                      <Label htmlFor="uploadToConvex" className="text-sm cursor-pointer">
                        Upload to Convex
                      </Label>
                    </div>

                    {uploadToConvex && (
                      <div className="flex items-center gap-3 text-sm">
                        <div className="flex items-center gap-1.5">
                          <Checkbox
                            id="env-dev"
                            checked={environments.has('dev')}
                            onCheckedChange={() => handleEnvToggle('dev')}
                          />
                          <Label htmlFor="env-dev" className="text-sm cursor-pointer">Dev</Label>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Checkbox
                            id="env-prod"
                            checked={environments.has('prod')}
                            onCheckedChange={() => handleEnvToggle('prod')}
                          />
                          <Label htmlFor="env-prod" className="text-sm cursor-pointer">Prod</Label>
                        </div>
                      </div>
                    )}
                  </div>

                  <Button
                    size="sm"
                    onClick={handleProcess}
                    disabled={selectedFields.size === 0 || (uploadToConvex && environments.size === 0)}
                  >
                    <Filter className="mr-2 h-4 w-4" />
                    Process & Upload
                  </Button>
                </CardContent>
              </Card>
            </>
          )}

          {/* Processing State */}
          {state.step === 'processing' && (
            <Card>
              <CardContent className="py-8">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <div className="text-center">
                    <p className="font-medium">Processing...</p>
                    <p className="text-sm text-muted-foreground">
                      Filtering and uploading accounts
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Completed State */}
          {state.step === 'completed' && (
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center gap-2 text-green-600 dark:text-green-500">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-semibold">Processing Complete</span>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center p-3 bg-muted/50 rounded">
                    <p className="text-xl font-bold">{state.stats.totalProcessed.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Processed</p>
                  </div>
                  <div className="text-center p-3 bg-destructive/10 rounded">
                    <p className="text-xl font-bold text-destructive">{state.stats.removed.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Filtered</p>
                  </div>
                  <div className="text-center p-3 bg-green-500/10 rounded">
                    <p className="text-xl font-bold text-green-600 dark:text-green-500">{state.stats.remaining.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Kept</p>
                  </div>
                </div>

                {/* Upload results */}
                {Object.keys(state.uploaded).length > 0 && (
                  <div className="space-y-1.5">
                    {Object.entries(state.uploaded).map(([env, count]) => {
                      const dupes = state.duplicates[env] || 0
                      return (
                        <div key={env} className="flex items-center gap-2 text-sm">
                          <span className="text-muted-foreground capitalize">{env}:</span>
                          <Badge variant="secondary" className="text-xs">
                            {count.toLocaleString()} new
                          </Badge>
                          {dupes > 0 && (
                            <Badge variant="outline" className="text-xs text-amber-600 border-amber-600/30">
                              {dupes.toLocaleString()} duplicates
                            </Badge>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                <Button variant="outline" size="sm" onClick={handleReset}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Upload Another
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
