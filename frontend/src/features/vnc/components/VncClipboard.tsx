import { useCallback, useState } from 'react'
import { Clipboard } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { ApiError, apiFetch } from '@/lib/api'

// Server-side clipboard (option 2): the API reads/writes the X CLIPBOARD
// selection on the session DISPLAY via xclip. Local access still needs a
// user click (browsers gate navigator.clipboard behind a gesture), so this
// stays an explicit button flow — no background sync.

function clipboardErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    if (e.status === 404) return 'Session ended — refresh the list'
    try {
      const parsed = JSON.parse(e.message) as { error?: { message?: unknown } }
      const message = parsed?.error?.message
      if (typeof message === 'string' && message.trim()) return message
    } catch { /* fall through to fallback */ }
    return fallback
  }
  if (e instanceof DOMException && e.name === 'NotAllowedError') {
    return 'Clipboard blocked — allow access or type into the box'
  }
  return fallback
}

export function VncClipboardButton({
  vncPort,
  interactive,
}: {
  vncPort: number
  interactive: boolean
}) {
  const [pasteDraft, setPasteDraft] = useState('')
  const [remoteText, setRemoteText] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const sendToRemote = useCallback(async (text: string) => {
    if (!text) {
      toast.info('Nothing to send')
      return
    }
    setBusy(true)
    try {
      await apiFetch(`/api/displays/${vncPort}/clipboard`, {
        method: 'POST',
        body: { text },
      })
      toast.success('Sent — press Ctrl+V inside the remote browser')
    } catch (e) {
      toast.error(clipboardErrorMessage(e, 'Could not send to remote'))
    } finally {
      setBusy(false)
    }
  }, [vncPort])

  // Must run directly in the click handler — keeps user activation for readText().
  const handlePasteFromPc = useCallback(async () => {
    if (!interactive || busy) return
    setBusy(true)
    try {
      const text = await navigator.clipboard.readText()
      if (!text) {
        toast.info('Your clipboard is empty')
        return
      }
      setPasteDraft(text)
      await apiFetch(`/api/displays/${vncPort}/clipboard`, {
        method: 'POST',
        body: { text },
      })
      toast.success('Sent — press Ctrl+V inside the remote browser')
    } catch (e) {
      toast.error(clipboardErrorMessage(e, 'Could not send to remote'))
    } finally {
      setBusy(false)
    }
  }, [busy, interactive, vncPort])

  const handleLoadFromRemote = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await apiFetch<{ text: string }>(`/api/displays/${vncPort}/clipboard`)
      if (!result.text) {
        setRemoteText(null)
        toast.info('Remote clipboard is empty')
        return
      }
      setRemoteText(result.text)
    } catch (e) {
      toast.error(clipboardErrorMessage(e, 'Could not read remote clipboard'))
    } finally {
      setBusy(false)
    }
  }, [busy, vncPort])

  const handleCopyToPc = useCallback(async () => {
    if (!remoteText || busy) return
    setBusy(true)
    try {
      await navigator.clipboard.writeText(remoteText)
      toast.success('Copied to this PC')
    } catch {
      toast.error('Clipboard blocked — select the text and copy manually')
    } finally {
      setBusy(false)
    }
  }, [busy, remoteText])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          title="Clipboard: send text to / copy from the remote browser"
        >
          <Clipboard className="mr-2 h-3.5 w-3.5" />
          Clipboard
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <p className="mb-2 text-sm font-medium">Clipboard</p>

        <p className="text-subtle-copy mb-1 text-[11px]">To remote</p>
        <Textarea
          value={pasteDraft}
          onChange={(e) => setPasteDraft(e.target.value)}
          placeholder="Type or paste text here…"
          rows={3}
          className="mb-2"
        />
        <div className="mb-3 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handlePasteFromPc()}
            disabled={!interactive || busy}
            className="flex-1"
            title={interactive ? 'Read this PC clipboard and send' : 'Take control to paste'}
          >
            {busy ? 'Working…' : 'From my PC'}
          </Button>
          <Button
            size="sm"
            onClick={() => void sendToRemote(pasteDraft)}
            disabled={!interactive || busy || !pasteDraft}
            className="flex-1"
          >
            Send to remote
          </Button>
        </div>
        {!interactive ? (
          <p className="text-subtle-copy mb-3 text-[11px]">Take control to paste.</p>
        ) : (
          <p className="text-subtle-copy mb-3 text-[11px]">After sending, press Ctrl+V inside the remote.</p>
        )}

        <p className="text-subtle-copy mb-1 text-[11px]">From remote</p>
        {remoteText ? (
          <>
            <Textarea value={remoteText} readOnly rows={3} className="mb-2" />
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleLoadFromRemote()}
                disabled={busy}
                className="flex-1"
              >
                Reload
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleCopyToPc()}
                disabled={busy}
                className="flex-1"
              >
                Copy to my PC
              </Button>
            </div>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleLoadFromRemote()}
            disabled={busy}
            className="w-full"
          >
            {busy ? 'Loading…' : 'Load from remote'}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
