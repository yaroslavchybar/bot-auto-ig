import { useCallback, useRef, useState } from 'react'
import { Files, RefreshCw, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ApiError, apiFetch, apiUploadFile } from '@/lib/api'

const ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp'

export type VpsUpload = { name: string; size: number; mtime: number }

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

// Server/proxy failures come back as raw HTML or JSON — never show that.
function uploadErrorMessage(e: unknown): string {
  if (e instanceof ApiError && e.status === 413) {
    return 'Photo too large (max 500 MB)'
  }
  return 'Upload failed — try a smaller jpg, png, or webp'
}

// Upload a photo from this PC to the VPS so it can be picked
// inside the remote GTK file dialog under Downloads > Uploads.
// Explicit button flow only — no auto-upload.
export function useVncFileUpload() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  // Ref-based lock: set synchronously on entry so a double pick
  // can't start a second request while one is in flight.
  const lockRef = useRef(false)
  const [uploading, setUploading] = useState(false)
  const [lastUpload, setLastUpload] = useState<string | null>(null)

  const [files, setFiles] = useState<VpsUpload[]>([])

  const refreshFiles = useCallback(async () => {
    try {
      setFiles(await apiFetch<VpsUpload[]>('/api/displays/uploads'))
    } catch {
      // List is best-effort; upload/delete surface their own errors.
    }
  }, [])

  const uploadFile = async (file: File) => {
    if (lockRef.current) return
    lockRef.current = true
    setUploading(true)
    try {
      const result = await apiUploadFile('/api/displays/uploads', file)
      setLastUpload(result.filename)
      toast.success('Photo on VPS — pick it under Downloads > Uploads in the remote dialog')
      await refreshFiles()
    } catch (e) {
      toast.error(uploadErrorMessage(e))
    } finally {
      lockRef.current = false
      setUploading(false)
    }
  }

  const removeFile = async (name: string) => {
    try {
      await apiFetch('/api/displays/uploads/' + encodeURIComponent(name), {
        method: 'DELETE',
      })
      toast.success('File removed from VPS')
      await refreshFiles()
    } catch {
      toast.error('Could not remove file')
    }
  }

  const openPicker = () => {
    // Must run directly in click handler — keeps user activation for picker.
    inputRef.current?.click()
  }

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT}
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (file) void uploadFile(file)
      }}
    />
  )

  return { input, uploading, lastUpload, files, openPicker, uploadFile, removeFile, refreshFiles }
}

// Files sitting on the VPS, ready to pick in the remote dialog.
// The GTK open-dialog has no delete of its own, so removal lives here.
export function VncFilesButton({
  files,
  onDelete,
  onRefresh,
}: {
  files: VpsUpload[]
  onDelete: (name: string) => void
  onRefresh: () => void
}) {
  return (
    <Popover
      onOpenChange={(open) => {
        if (open) onRefresh()
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          title="Files uploaded to the VPS"
        >
          <Files className="mr-2 h-3.5 w-3.5" />
          {files.length > 0 ? `Files (${files.length})` : 'Files'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium">Files on VPS</p>
          <Button variant="ghost" size="icon" onClick={onRefresh} title="Refresh list" className="h-7 w-7">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
        {files.length === 0 ? (
          <p className="text-muted-foreground text-xs">Nothing uploaded yet.</p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-auto">
            {files.map((file) => (
              <li
                key={file.name}
                className="flex items-center gap-2 rounded-md px-1 py-1 text-xs"
              >
                <span className="min-w-0 flex-1 truncate" title={file.name}>
                  {file.name}
                </span>
                <span className="text-muted-foreground shrink-0">{formatSize(file.size)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDelete(file.name)}
                  title={'Remove ' + file.name}
                  className="h-7 w-7 shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground mt-2 text-[11px]">
          Pick them under Downloads &gt; Uploads in the remote dialog.
        </p>
      </PopoverContent>
    </Popover>
  )
}

export function VncUploadButton({
  uploading,
  onClick,
}: {
  uploading: boolean
  onClick: () => void
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={uploading}
      className="h-8"
      title="Upload files from this PC to the VPS"
    >
      <Upload className="mr-2 h-3.5 w-3.5" />
      {uploading ? 'Uploading…' : 'Upload files'}
    </Button>
  )
}
