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

type Account = { status: string }

export function BatchCreateForm({ onCreated, onCancel }: { onCreated: () => Promise<void>; onCancel: () => void }) {
  const models = useQuery(api.lists.list, {})
  const [modelId, setModelId] = useState('')
  const [count, setCount] = useState(1)
  const [available, setAvailable] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    void apiFetch<Account[]>('/api/ig-accounts').then(rows =>
      setAvailable(rows.filter(row => row.status === 'available').length)).catch(() => setAvailable(null))
  }, [])
  const overAvailable = available !== null && count > available
  const invalidCount = count < 1 || count > 100
  async function create() {
    if (!modelId || invalidCount || overAvailable || busy) return
    setBusy(true); setError('')
    try {
      await apiFetch('/api/ig-accounts/create-batch', { method: 'POST',
        body: { modelId, count }, timeout: 120_000 })
      await onCreated()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return (
    <div className="flex flex-col">
      <div className="grid gap-5 pb-2">
        <p className="text-subtle-copy text-sm">
          Create profiles from unused IG credentials and saved proxies. Login starts after creation.
        </p>
        <div className="grid gap-1.5">
          <Label htmlFor="batch-model" className="text-muted-copy text-xs font-semibold tracking-wider uppercase">
            Model
          </Label>
          <Select value={modelId} onValueChange={setModelId} disabled={busy}>
            <SelectTrigger id="batch-model" className="brand-focus bg-field border-line h-9 text-ink">
              <SelectValue placeholder={models === undefined ? 'Loading models...' : 'Choose model'} />
            </SelectTrigger>
            <SelectContent className="panel-dropdown">
              {models?.map((model) => (
                <SelectItem
                  key={model._id}
                  value={model._id}
                  className="focus:bg-panel-hover cursor-pointer focus:text-ink"
                >
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="batch-count" className="text-muted-copy text-xs font-semibold tracking-wider uppercase">
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
            className="brand-focus bg-field border-line h-9 text-ink"
          />
        </div>
        <div className="bg-panel-subtle border-line-soft rounded-md border p-3">
          <p className="text-subtle-copy text-xs">
            Unused credentials:{' '}
            <span className="text-copy font-medium tabular-nums">{available ?? 'loading...'}</span>
            {' · '}Each saved proxy allows up to its configured profile limit.
          </p>
          {overAvailable && (
            <p className="text-status-warning mt-1 text-xs">
              Requested count exceeds unused credentials — lower the count or import more.
            </p>
          )}
        </div>
      </div>

      <div className="border-line mt-4 shrink-0 border-t pt-4">
        {error && (
          <div className="text-status-danger bg-status-danger-soft border-status-danger-border mb-4 rounded-md border p-3 text-sm font-medium">
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
