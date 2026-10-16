import { useEffect, useRef, useState } from 'react'
import { Pencil, Plus, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  MAX_INTERESTS,
  MAX_INTEREST_LABEL,
  type Interest,
} from '../../../../../server/shared/interests'

/** Each tag has one AI interpretation; edits replace that interpretation before saving. */
export function RoutineInterests({
  value,
  onChange,
  onPendingChange,
  disabled,
}: {
  value: Interest[]
  onChange: (value: Interest[]) => void
  onPendingChange: (pending: boolean) => void
  disabled: boolean
}) {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => {
    onPendingChange(busy || !!draft.trim())
  }, [busy, draft, onPendingChange])
  useEffect(() => () => request.current?.abort(), [])

  const discard = () => {
    setOpen(false)
    setDraft('')
    setEditing(null)
    setError('')
  }
  async function add() {
    const label = draft.trim()
    if (!label || busy || disabled) return
    if (
      value.some(
        (item, index) => index !== editing && item.label.toLowerCase() === label.toLowerCase(),
      )
    ) {
      setError('This interest is already added')
      return
    }
    if (editing === null && value.length >= MAX_INTERESTS) {
      setError(`Use at most ${MAX_INTERESTS} interests`)
      return
    }
    setBusy(true)
    setError('')
    const controller = new AbortController()
    request.current = controller
    try {
      const { description } = await apiFetch<{ description: string }>(
        '/api/automations/interests/rewrite',
        {
          method: 'POST',
          body: { label },
          signal: controller.signal,
          timeout: 25_000,
        },
      )
      if (controller.signal.aborted) return
      const item = { label, description }
      onChange(
        editing === null
          ? [...value, item]
          : value.map((old, index) => (index === editing ? item : old)),
      )
      discard()
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : 'Could not rewrite interest. Try again.')
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">Interests</h3>
        <Button
          type="button"
          className="shrink-0 brand-button"
          disabled={disabled || busy || value.length >= MAX_INTERESTS}
          onClick={() => {
            discard()
            setOpen(true)
          }}
        >
          <Plus className="mr-2 h-3.5 w-3.5" /> Add interest
        </Button>
      </div>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !busy) discard()
        }}
      >
        <DialogContent
          className="flex max-h-[90vh] flex-col border-line bg-panel text-ink sm:max-w-[560px]"
          aria-describedby={undefined}
          hideClose={busy}
        >
          <DialogHeader>
            <DialogTitle className="page-title-gradient">
              {editing === null ? 'Add interest' : 'Edit interest'}
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault()
              void add()
            }}
          >
            <div className="space-y-2">
              <label htmlFor="routine-interest" className="text-sm font-medium">
                Interest
              </label>
              <Input
                id="routine-interest"
                value={draft}
                maxLength={MAX_INTEREST_LABEL}
                disabled={disabled || busy}
                placeholder="For example: fishing content"
                onChange={(event) => {
                  setDraft(event.target.value)
                  setError('')
                }}
              />
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={busy} onClick={discard}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="brand-button"
                disabled={
                  disabled ||
                  busy ||
                  !draft.trim() ||
                  (editing === null && value.length >= MAX_INTERESTS)
                }
              >
                {busy ? 'Rewriting…' : editing === null ? 'Add interest' : 'Update interest'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {value.length > 0 && (
        <ul className="space-y-3" aria-label="Saved interests">
          {value.map((item, index) => (
            <li key={item.label} className="space-y-2 rounded-xl border p-4">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-muted px-3 py-1 text-sm break-words">
                  {item.label}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="ml-auto shrink-0"
                  disabled={disabled || busy}
                  aria-label={`Edit ${item.label}`}
                  onClick={() => {
                    setDraft(item.label)
                    setEditing(index)
                    setError('')
                    setOpen(true)
                  }}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={disabled || busy}
                  aria-label={`Remove ${item.label}`}
                  onClick={() => {
                    onChange(value.filter((_, i) => i !== index))
                    discard()
                  }}
                >
                  <X className="size-4" />
                </Button>
              </div>
              <p className="text-sm break-words text-muted-foreground">{item.description}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
