import { useState } from 'react'
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
import { cn } from '@/lib/utils'
import type { ProxyFormValues, ProxyItem } from '../types'
import { normalizeProxy } from '../../../../../server/shared/proxy'
import { stripScheme } from '../utils/maskProxy'

interface ProxiesFormProps {
  mode: 'create' | 'edit'
  initialData?: ProxyItem | null
  existingNames: string[]
  saving: boolean
  onSave: (values: ProxyFormValues) => void
  onCancel: () => void
  className?: string
}

export function ProxiesForm({
  mode,
  initialData,
  existingNames,
  saving,
  onSave,
  onCancel,
  className,
}: ProxiesFormProps) {
  const [name, setName] = useState(initialData?.name ?? '')
  const [proxyType, setProxyType] = useState(initialData?.proxyType ?? 'http')
  const [proxy, setProxy] = useState(initialData?.proxy ?? '')
  const [maxProfiles, setMaxProfiles] = useState(
    initialData && initialData.maxProfiles >= 1 ? String(initialData.maxProfiles) : '3',
  )
  const [localError, setLocalError] = useState<string | null>(null)

  const handleSubmit = () => {
    const trimmedName = name.trim()
    const trimmedProxy = proxy.trim()
    if (!trimmedName) {
      setLocalError('Name is required')
      return
    }
    if (!trimmedProxy) {
      setLocalError('Proxy is required')
      return
    }
    const limit = Math.floor(Number(maxProfiles))
    if (!Number.isFinite(limit) || limit < 1) {
      setLocalError('Limit must be at least 1')
      return
    }
    const isSameName = mode === 'edit' && initialData?.name === trimmedName
    if (!isSameName && existingNames.includes(trimmedName)) {
      setLocalError('Name already exists')
      return
    }
    try {
      const normalized = normalizeProxy(trimmedProxy, proxyType)
      if (!normalized.proxy) { setLocalError('Proxy is required'); return }
      setLocalError(null)
      onSave({ name: trimmedName, ...normalized, maxProfiles: limit })
    } catch {
      setLocalError('Invalid proxy URL or protocol')
    }
  }

  return (
    <div className={cn('flex flex-col p-6', className)}>
      <div className="grid gap-5 pb-6">
        <div className="grid gap-1.5">
          <Label
            htmlFor="proxy-name"
            className="text-muted-copy text-xs font-semibold tracking-wider uppercase"
          >
            Proxy Name
          </Label>
          <Input
            id="proxy-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setLocalError(null)
            }}
            disabled={saving}
            placeholder="e.g. US residential 1"
            autoFocus
            className="brand-focus bg-field border-line h-10 font-medium text-ink"
          />
        </div>

        <div className="grid gap-1.5">
          <Label
            htmlFor="proxy-type"
            className="text-muted-copy text-xs font-semibold tracking-wider uppercase"
          >
            Type
          </Label>
          <Select value={proxyType} onValueChange={(value) => { setProxyType(value); setProxy(stripScheme(proxy)) }} disabled={saving}>
            <SelectTrigger
              id="proxy-type"
              className="brand-focus bg-field border-line h-10 text-ink"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="panel-dropdown">
              <SelectItem value="http" className="focus:bg-panel-hover cursor-pointer focus:text-ink">
                HTTP
              </SelectItem>
              <SelectItem value="socks5" className="focus:bg-panel-hover cursor-pointer focus:text-ink">
                SOCKS5
              </SelectItem>
              <SelectItem value="https">HTTPS</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label
            htmlFor="proxy-value"
            className="text-muted-copy text-xs font-semibold tracking-wider uppercase"
          >
            Proxy
          </Label>
          <Input
            id="proxy-value"
            value={proxy}
            onChange={(e) => {
              setProxy(e.target.value)
              setLocalError(null)
            }}
            disabled={saving}
            placeholder="host:port:user:pass"
            className="brand-focus bg-field border-line h-10 font-mono text-sm text-ink"
          />
          <p className="text-subtle-copy ml-1 text-[10px]">
            Format: <span className="font-mono">host:port:user:pass</span> or{' '}
            <span className="font-mono">host:port</span>
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label
            htmlFor="proxy-limit"
            className="text-muted-copy text-xs font-semibold tracking-wider uppercase"
          >
            Profile limit
          </Label>
          <Input
            id="proxy-limit"
            type="number"
            min={1}
            step={1}
            value={maxProfiles}
            onChange={(e) => {
              setMaxProfiles(e.target.value)
              setLocalError(null)
            }}
            disabled={saving}
            className="brand-focus bg-field border-line h-10 font-medium text-ink"
          />
          <p className="text-subtle-copy ml-1 text-[10px]">
            How many profiles can use this proxy.
          </p>
        </div>
      </div>

      {localError && (
        <div className="text-status-danger bg-status-danger-soft border-status-danger-border mb-4 rounded-md border p-3 text-sm font-medium">
          {localError}
        </div>
      )}
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={saving} className="font-medium">
          {saving ? 'Saving...' : mode === 'create' ? 'Add Proxy' : 'Save Changes'}
        </Button>
      </div>
    </div>
  )
}
