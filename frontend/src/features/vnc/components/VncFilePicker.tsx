import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'

type Request = { id: string; multiple: boolean }

export function VncFilePicker({ vncPort, visible }: { vncPort: number; visible: boolean }) {
  const [request, setRequest] = useState<Request | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const selection = useRef<Request | null>(null)
  const upload = useRef<AbortController | null>(null)
  const prompted = useRef<string | null>(null)
  const dismissed = useRef<string | null>(null)
  const base = `/api/displays/${vncPort}/file-picker`

  // Visibility pauses polling, but uploads belong to the mounted session.
  useEffect(() => () => { upload.current?.abort() }, [base])

  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const pending = await apiFetch<Request | null>(`${base}?wait=1`, { signal: controller.signal, maxRetries: 1 })
        if (!controller.signal.aborted) setRequest(pending?.id === dismissed.current ? null : pending)
      } catch {
        if (!controller.signal.aborted) setRequest(null)
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 3000)
      }
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [base, visible])

  useEffect(() => {
    if (!visible || !request || prompted.current === request.id) return
    prompted.current = request.id
    selection.current = request
    // A click in the remote viewer may still grant local user activation.
    // If it has expired, the visible button opens the picker instead.
    if (navigator.userActivation?.isActive) {
      try { input.current?.showPicker() } catch { /* Keep the button available. */ }
    }
  }, [request, visible])

  const cancel = async () => {
    if (!request) return
    upload.current?.abort()
    try {
      await apiFetch(`${base}?id=${request.id}`, { method: 'DELETE' })
      dismissed.current = request.id
      setRequest(current => current?.id === request.id ? null : current)
    } catch { toast.error('Could not cancel file selection') }
  }

  const attach = async (files: File[]) => {
    const target = selection.current
    if (!target || !files.length) return
    if (files.length > 20 || files.reduce((sum, file) => sum + file.size, 0) >= 50 * 1024 * 1024) {
      toast.error('Choose up to 20 files, less than 50 MiB total')
      return
    }
    const controller = new AbortController()
    upload.current = controller
    setBusy(true)
    try {
      const metadata = new TextEncoder().encode(JSON.stringify(files.map(file => ({ name: file.name, type: file.type, size: file.size }))))
      const header = new ArrayBuffer(4)
      new DataView(header).setUint32(0, metadata.byteLength)
      await apiFetch(`${base}?id=${target.id}`, { method: 'POST', body: new Blob([header, metadata, ...files]), timeout: 120_000, signal: controller.signal })
      dismissed.current = target.id
      setRequest(current => current?.id === target.id ? null : current)
      toast.success('Files attached')
    } catch {
      if (!controller.signal.aborted) toast.error('Could not attach files. Try again or click Upload on the site again.')
    } finally {
      if (upload.current === controller) { upload.current = null; setBusy(false) }
    }
  }

  if (!request) return null
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40" onKeyDown={event => event.stopPropagation()}>
      <div className="flex max-w-sm flex-col gap-3 rounded-lg border border-line bg-overlay p-5 text-ink shadow-xl">
        <p className="text-sm font-medium">The website is asking for files</p>
        <input ref={input} type="file" className="hidden" multiple={request.multiple}
          onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void attach(files) }} />
        <Button disabled={busy} onClick={() => { selection.current = request; input.current?.click() }}>
          {busy ? 'Attaching files…' : 'Choose files from this PC'}
        </Button>
        <Button variant="outline" onClick={() => void cancel()}>Cancel</Button>
      </div>
    </div>
  )
}
