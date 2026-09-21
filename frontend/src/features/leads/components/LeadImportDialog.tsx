import { useEffect, useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'
import { FileUp, TriangleAlert } from 'lucide-react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { normalizeUsername } from '../../../../../convex/leadImport'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { parseLeadImport, parseCsvTable, findUsernameColumn } from '../import'

export type LeadListOption = { _id: Id<'leadLists'>; name: string }

interface LeadImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  lists: LeadListOption[] | undefined
  defaultListId: Id<'leadLists'> | undefined
}

/** Pick the column with the most valid-looking usernames in a sample. */
function detectUsernameColumn(
  headers: string[],
  rows: string[][],
  hasHeader: boolean,
): number {
  if (hasHeader) {
    const named = findUsernameColumn(headers)
    if (named >= 0) return named
  }
  let best = 0,
    bestScore = -1
  for (let c = 0; c < headers.length; c++) {
    let score = 0
    for (const r of rows.slice(0, 20)) if (normalizeUsername(r[c])) score++
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  return best
}

export function LeadImportDialog({
  open,
  onOpenChange,
  lists,
  defaultListId,
}: LeadImportDialogProps) {
  const importLeads = useMutation(api.leads.importLeads)
  const [targetListId, setTargetListId] = useState<string>('')
  const [text, setText] = useState('')
  /** Explicit column pick; null means auto-detect. Reset on text change. */
  const [usernameCol, setUsernameCol] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setTargetListId(defaultListId ?? '')
        setText('')
      setUsernameCol(null)
      setBusy(false)
    }
  }, [open, defaultListId])

  const handleFile = (file: File | undefined) => {
    if (!file) return
    if (file.size > 2_000_000) {
      toast.error('File must be under 2 MB')
      return
    }
    void file
      .text()
      .then((t) => {
        setText(t)
        setUsernameCol(null)
      })
      .catch((e) => toast.error(String(e)))
  }

  const table = useMemo(() => {
    if (!text.trim()) return null
    try {
      const parsed = parseCsvTable(text)
      if (parsed.headers.length <= 1 || !parsed.rows.length) return null
      return parsed
    } catch {
      return null
    }
  }, [text])

  const effectiveCol = table
    ? (usernameCol ?? detectUsernameColumn(table.headers, table.rows, table.hasHeader))
    : 0

  const { values, parseError } = useMemo(() => {
    if (!text.trim()) return { values: [] as string[], parseError: null as string | null }
    try {
      if (table)
        return {
          values: table.rows
            .map((r) => r[effectiveCol]?.trim() ?? '')
            .filter(Boolean),
          parseError: null,
        }
      return { values: parseLeadImport(text), parseError: null }
    } catch (e) {
      return { values: [] as string[], parseError: String(e) }
    }
  }, [text, table, effectiveCol])

  const uniqueValid = new Set(values.map(normalizeUsername).filter(Boolean)).size
  const invalidCount = values.filter((v) => !normalizeUsername(v)).length
  const tooMany = values.length > 500
  const canImport =
    !!targetListId && !busy && !parseError && !tooMany && uniqueValid > 0

  const handleImport = async () => {
    if (!targetListId || !uniqueValid) return
    setBusy(true)
    try {
      const result = await importLeads({
        listId: targetListId as Id<'leadLists'>,
        usernames: values,
      })
      toast.success(
        `${result.added} added, ${result.duplicates} duplicates, ${result.invalid} invalid`,
      )
      onOpenChange(false)
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-panel border-line text-ink flex max-h-[90vh] flex-col sm:max-w-[560px]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="page-title-gradient">Import leads</DialogTitle>
          <DialogDescription className="text-subtle-copy">
            Drop a CSV or text file, pick which column holds the usernames.
            Existing leads keep their DM and follow flags.
          </DialogDescription>
        </DialogHeader>

        <div className="grid flex-1 gap-4 overflow-y-auto py-1">
          <div className="grid gap-2">
            <Label htmlFor="lead-import-list">Target list</Label>
            <Select value={targetListId} onValueChange={setTargetListId}>
              <SelectTrigger id="lead-import-list" className="bg-field border-line">
                <SelectValue placeholder="Select a list" />
              </SelectTrigger>
              <SelectContent className="panel-dropdown">
                {lists?.map((l) => (
                  <SelectItem key={l._id} value={l._id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="lead-import-file">CSV file</Label>
            <label
              htmlFor="lead-import-file"
              className="border-line-soft bg-panel-subtle hover:border-line-strong flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed p-4 transition-colors"
            >
              <FileUp className="text-subtle-copy h-5 w-5 shrink-0" />
              <span className="text-muted-copy text-sm">
                Drop a <span className="text-copy font-medium">.csv or .txt</span> file
                here, or click to browse (max 2 MB)
              </span>
            </label>
            <input
              id="lead-import-file"
              type="file"
              accept=".csv,.txt"
              className="sr-only"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </div>

          {table && (
            <div className="border-line-soft bg-panel-subtle space-y-2 rounded-xl border p-3">
              <p className="text-copy text-sm font-medium">
                Assign columns
                <span className="text-muted-copy font-normal">
                  {' '}· pick which column holds the usernames, the rest are
                  ignored
                </span>
              </p>
              <div className="space-y-2">
                {table.headers.map((h, i) => {
                  const sample = table.rows
                    .map((r) => r[i])
                    .filter(Boolean)
                    .slice(0, 3)
                  return (
                    <div
                      key={i}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <Select
                        value={i === effectiveCol ? 'username' : 'ignore'}
                        onValueChange={(v) => {
                          if (v === 'username') setUsernameCol(i)
                        }}
                      >
                        <SelectTrigger className="bg-field border-line w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="panel-dropdown">
                          <SelectItem value="username">Username</SelectItem>
                          <SelectItem value="ignore">Ignore</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="min-w-0 flex-1">
                        <p className="text-copy truncate text-sm font-medium">
                          {h}
                        </p>
                        <p className="text-muted-copy truncate font-mono text-xs">
                          {sample.length ? sample.join(' · ') : '—'}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {text.trim() !== '' && (
            <div className="text-sm">
              {parseError ? (
                <p className="text-status-warning flex items-center gap-1.5">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0" /> {parseError}
                </p>
              ) : tooMany ? (
                <p className="text-status-warning">
                  {values.length} rows — import up to 500 at once.
                </p>
              ) : (
                <p className="text-copy">
                  <span className="font-semibold">{uniqueValid}</span> unique valid
                  usernames
                  {invalidCount > 0 && (
                    <span className="text-status-warning">
                      {' '}· {invalidCount} invalid
                    </span>
                  )}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2">
          <Button
            onClick={() => void handleImport()}
            disabled={!canImport}
            className="brand-button"
          >
            {busy ? 'Importing...' : `Import ${uniqueValid} leads`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
