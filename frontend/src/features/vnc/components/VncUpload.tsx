import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ApiError, apiUploadFile } from '@/lib/api'

const ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp'

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

  const uploadFile = async (file: File) => {
    if (lockRef.current) return
    lockRef.current = true
    setUploading(true)
    try {
      const result = await apiUploadFile('/api/displays/uploads', file)
      setLastUpload(result.filename)
      toast.success('Photo on VPS — pick it under Downloads > Uploads in the remote dialog')
    } catch (e) {
      toast.error(uploadErrorMessage(e))
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
      title="Upload files from this PC to the VPS"
    >
      <Upload className="mr-2 h-3.5 w-3.5" />
      {uploading ? 'Uploading…' : 'Upload files'}
    </Button>
  )
}
