import { useCallback, useState, useRef, useMemo } from 'react'
import { useDataUploader } from './useDataUploader'
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
} from 'lucide-react'

export function AccountsPage() {
  const { state, uploadFile, processFile, reset } = useDataUploader()
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set())
  const [uploadToConvex, setUploadToConvex] = useState(true)
  const [environments, setEnvironments] = useState<Set<string>>(new Set(['dev']))
  const [dragActive, setDragActive] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const filteredFields = useMemo(() => {
    if (state.step !== 'selecting') return []
    if (!searchQuery.trim()) return state.fields
    return state.fields.filter(f =>
      f.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [state, searchQuery])

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

  const handleReset = useCallback(() => {
    reset()
    setSelectedFields(new Set())
    setEnvironments(new Set(['dev']))
    setSearchQuery('')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [reset])

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-2xl font-bold tracking-tight">Upload Accounts</h2>
        {state.step !== 'idle' && state.step !== 'uploading' && (
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Start Over
          </Button>
        )}
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
