import { useEffect, useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export function BatchCreateForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => Promise<void>
  onCancel: () => void
}) {
  const models = useQuery(api.lists.list, {})
  const [modelId, setModelId] = useState('')
  const [count, setCount] = useState(1)
  const [available, setAvailable] = useState<number | null>(null)
  const [availableCapped, setAvailableCapped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void apiFetch<{ available: number; capped?: boolean }>('/api/ig-accounts/available-count', {
      signal: controller.signal,
    })
      .then((rows) => {
        if (!controller.signal.aborted) {
          setAvailable(rows.available)
          setAvailableCapped(Boolean(rows.capped))
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setAvailable(null)
      })
    return () => controller.abort()
  }, [])
  const overAvailable = available !== null && count > available
  const invalidCount = count < 1 || count > 100
  async function create() {
    if (!modelId || invalidCount || overAvailable || busy) return
    setBusy(true)
    setError('')
    try {
      await apiFetch('/api/ig-accounts/create-batch', {
        method: 'POST',
        body: { modelId, count },
        timeout: 120_000,
      })
      await onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col">
      <div className="grid gap-5 pb-2">
        <p className="text-sm text-subtle-copy">
          Create profiles from unused IG credentials and saved proxies. Login starts after creation.
        </p>
        <div className="grid gap-1.5">
          <Label
            htmlFor="batch-model"
            className="text-xs font-semibold tracking-wider text-muted-copy uppercase"
          >
            Model
          </Label>
          <Select value={modelId} onValueChange={setModelId} disabled={busy}>
            <SelectTrigger
              id="batch-model"
              className="h-9 brand-focus border-line bg-field text-ink"
            >
              <SelectValue
                placeholder={models === undefined ? 'Loading models...' : 'Choose model'}
              />
            </SelectTrigger>
            <SelectContent className="panel-dropdown">
              {models?.map((model) => (
                <SelectItem
                  key={model._id}
                  value={model._id}
                  className="cursor-pointer focus:bg-panel-hover focus:text-ink"
                >
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label
            htmlFor="batch-count"
            className="text-xs font-semibold tracking-wider text-muted-copy uppercase"
          >
            New profiles
          </Label>
          <Input
            id="batch-count"
            type="number"
            min={1}
            max={100}
            value={count}
            disabled={busy}
            onChange={(e) => setCount(Number(e.target.value))}
            className="h-9 brand-focus border-line bg-field text-ink"
          />
        </div>
        <div className="rounded-md border border-line-soft bg-panel-subtle p-3">
          <p className="text-xs text-subtle-copy">
            Unused credentials:{' '}
            <span className="font-medium text-copy tabular-nums">
              {available === null ? 'loading...' : `${available}${availableCapped ? '+' : ''}`}
            </span>
            {' · '}Each saved proxy allows up to its configured profile limit.
          </p>
          {overAvailable && (
            <p className="mt-1 text-xs text-status-warning">
              Requested count exceeds unused credentials — lower the count or import more.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 shrink-0 border-t border-line pt-4">
        {error && (
          <div className="mb-4 rounded-md border border-status-danger-border bg-status-danger-soft p-3 text-sm font-medium text-status-danger">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void create()}
            disabled={busy || !modelId || invalidCount || overAvailable}
            className="brand-button font-medium"
          >
            {busy ? 'Creating...' : 'Create Profiles'}
          </Button>
        </div>
      </div>
    </div>
  )
}
