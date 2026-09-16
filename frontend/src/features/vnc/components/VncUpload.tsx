import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { apiUploadFile } from '@/lib/api'

const ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp'

// Upload a photo from this PC to the server so it can be picked
// inside the remote GTK file dialog under Downloads > Uploads.
export function useVncFileUpload() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  // Ref-based lock: set synchronously on entry so overlapping picks/drops
  // can't start a second request while one is in flight.
  const lockRef = useRef(false)
  const [uploading, setUploading] = useState(false)
  const [lastUpload, setLastUpload] = useState<string | null>(null)

  const uploadFile = async (file: File) => {
    if (lockRef.current) return
    lockRef.current = true
    setUploading(true)
    try {
      const result = await apiUploadFile('/api/displays/uploads', file)
      setLastUpload(result.filename)
      toast.success('Photo ready — pick it under Downloads > Uploads in the remote dialog')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      lockRef.current = false
      setUploading(false)
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

  return { input, uploading, lastUpload, openPicker, uploadFile }
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
      title="Upload a photo from this PC"
    >
      <Upload className="mr-2 h-3.5 w-3.5" />
      {uploading ? 'Uploading…' : 'Upload photo'}
    </Button>
  )
}

// Wrap the VNC viewer to accept dropped image files from this PC.
// Drops are ignored while disabled (an upload is already in flight);
// uploadFile's ref lock is the backstop for other entry paths.
export function VncDropZone({
  onFile,
  disabled,
  children,
}: {
  onFile: (file: File) => void
  disabled?: boolean
  children: React.ReactNode
}) {
  const [dragging, setDragging] = useState(false)

  return (
    <div
      className="relative h-full w-full"
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (disabled) return
        const file = e.dataTransfer.files?.[0]
        if (file) onFile(file)
      }}
    >
      {children}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-[3px] border-2 border-dashed border-white/60 bg-black/60">
          <p className="text-sm font-medium text-white">Drop photo to upload</p>
        </div>
      )}
    </div>
  )
}
