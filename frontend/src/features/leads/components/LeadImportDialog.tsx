import { useEffect, useState } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'
import { FileUp, TriangleAlert } from 'lucide-react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { normalizeUsername } from '../../../../../convex/leadImport'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import { parseLeadImport } from '../import'

export type LeadListOption = { _id: Id<'leadLists'>; name: string }

interface LeadImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  lists: LeadListOption[] | undefined
  defaultListId: Id<'leadLists'> | undefined
  onImported: () => void
}

export function LeadImportDialog({
  open,
  onOpenChange,
  lists,
  defaultListId,
  onImported,
}: LeadImportDialogProps) {
  const importLeads = useMutation(api.leads.importLeads)
  const [targetListId, setTargetListId] = useState<string>('')
  const [source, setSource] = useState('')
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setTargetListId(defaultListId ?? '')
      setSource('')
      setText('')
      setPreview(null)
      setBusy(false)
    }
  }, [open, defaultListId])

  const handlePreview = () => {
    try {
      const values = parseLeadImport(text)
      if (values.length > 500) throw new Error('Import up to 500 rows at once')
      if (!values.length) throw new Error('Nothing to import')
      setPreview(values)
    } catch (e) {
      toast.error(String(e))
    }
  }

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
        setSource((s) => s || file.name)
        setPreview(null)
      })
      .catch((e) => toast.error(String(e)))
  }

  const uniqueValid = preview
    ? new Set(preview.map(normalizeUsername).filter(Boolean)).size
    : 0
  const invalidCount = preview
    ? preview.filter((v) => !normalizeUsername(v)).length
    : 0

  const handleImport = async () => {
    if (!preview || !targetListId) return
    setBusy(true)
    try {
      const result = await importLeads({
        listId: targetListId as Id<'leadLists'>,
        usernames: preview,
        source,
      })
      toast.success(
        `${result.added} added, ${result.duplicates} duplicates, ${result.invalid} invalid`,
      )
      onImported()
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
            Paste usernames, profile URLs, or CSV with a username column.
            Existing leads keep their status.
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
            <Label htmlFor="lead-import-source">Source / notes</Label>
            <Input
              id="lead-import-source"
              placeholder="Where did these come from?"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="bg-field border-line"
            />
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

          <div className="grid gap-2">
            <Label htmlFor="lead-import-text">Usernames or CSV</Label>
            <Textarea
              id="lead-import-text"
              rows={5}
              placeholder="@username per line, profile URL, or pasted CSV"
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setPreview(null)
              }}
              className="bg-field border-line font-mono text-xs"
            />
          </div>

          {preview && (
            <div className="border-line-soft bg-panel-subtle space-y-2 rounded-xl border p-3">
              <p className="text-copy text-sm">
                <span className="font-semibold">{uniqueValid}</span> unique valid
                usernames
                {invalidCount > 0 && (
                  <span className="text-status-warning">
                    {' '}· {invalidCount} invalid
                  </span>
                )}
              </p>
              <div className="text-muted-copy max-h-36 space-y-0.5 overflow-auto font-mono text-xs">
                {preview.slice(0, 30).map((v, i) =>
                  normalizeUsername(v) ? (
                    <div key={i}>@{normalizeUsername(v)}</div>
                  ) : (
                    <div key={i} className="text-status-warning flex items-center gap-1.5">
                      <TriangleAlert className="h-3 w-3 shrink-0" /> Invalid: {v}
                    </div>
                  ),
                )}
                {preview.length > 30 && (
                  <div className="text-subtle-copy">
                    …and {preview.length - 30} more
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2">
          {!preview ? (
            <Button
              onClick={handlePreview}
              disabled={!text.trim() || busy}
              className="brand-button"
            >
              Preview import
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => setPreview(null)}
                disabled={busy}
                className="button-ghost"
              >
                Back
              </Button>
              <Button
                onClick={() => void handleImport()}
                disabled={!targetListId || busy || uniqueValid === 0}
                className="brand-button"
              >
                {busy ? 'Importing...' : `Import ${uniqueValid} leads`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
