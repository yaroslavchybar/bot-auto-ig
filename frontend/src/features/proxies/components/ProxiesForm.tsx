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
import { formatProxyForInput } from '../utils/formatProxyForInput'
import { CountrySelect } from './CountrySelect'

interface ProxiesFormProps {
  mode: 'create' | 'edit'
  initialData?: ProxyItem | null
  saving: boolean
  onSave: (values: ProxyFormValues) => void
  onCancel: () => void
  className?: string
}

export function ProxiesForm({
  mode,
  initialData,
  saving,
  onSave,
  onCancel,
  className,
}: ProxiesFormProps) {
  const [name, setName] = useState(initialData?.name ?? '')
  const [proxyType, setProxyType] = useState(initialData?.proxyType ?? 'http')
  const [purpose, setPurpose] = useState<'work' | 'login'>(initialData?.purpose ?? 'work')
  const [country, setCountry] = useState(initialData?.country ?? '')
  const [proxy, setProxy] = useState(() =>
    formatProxyForInput(initialData?.proxy, initialData?.proxyType),
  )
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
    if (purpose === 'login' && !country) {
      setLocalError('Choose the login proxy country')
      return
    }
    const limit = purpose === 'login' ? 3 : Math.floor(Number(maxProfiles))
    if (purpose === 'work' && (!Number.isFinite(limit) || limit < 1)) {
      setLocalError('Limit must be at least 1')
      return
    }
    try {
      const normalized = normalizeProxy(trimmedProxy, proxyType)
      if (!normalized.proxy) {
        setLocalError('Proxy is required')
        return
      }
      setLocalError(null)
      onSave({ name: trimmedName, ...normalized, purpose, country, maxProfiles: limit })
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
            className="text-xs font-semibold tracking-wider text-muted-copy uppercase"
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
            className="h-10 brand-focus border-line bg-field font-medium text-ink"
          />
        </div>

        <div className="grid gap-1.5">
          <Label
            htmlFor="proxy-purpose"
            className="text-xs font-semibold tracking-wider text-muted-copy uppercase"
          >
            Use for
          </Label>
          <Select
            value={purpose}
            onValueChange={(value: 'work' | 'login') => setPurpose(value)}
            disabled={saving}
          >
            <SelectTrigger
              id="proxy-purpose"
              className="h-10 brand-focus border-line bg-field text-ink"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="panel-dropdown">
              <SelectItem value="work">Work</SelectItem>
              <SelectItem value="login">Login</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <CountrySelect value={country} onChange={setCountry} disabled={saving} />

        <div className="grid gap-1.5">
          <Label
            htmlFor="proxy-type"
            className="text-xs font-semibold tracking-wider text-muted-copy uppercase"
          >
            Type
          </Label>
          <Select
            value={proxyType}
            onValueChange={(value) => {
              setProxyType(value)
              setProxy(stripScheme(proxy))
            }}
            disabled={saving}
          >
            <SelectTrigger
              id="proxy-type"
              className="h-10 brand-focus border-line bg-field text-ink"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="panel-dropdown">
              <SelectItem
                value="http"
                className="cursor-pointer focus:bg-panel-hover focus:text-ink"
              >
                HTTP
              </SelectItem>
              <SelectItem
                value="socks5"
                className="cursor-pointer focus:bg-panel-hover focus:text-ink"
              >
                SOCKS5
              </SelectItem>
              <SelectItem value="https">HTTPS</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label
            htmlFor="proxy-value"
            className="text-xs font-semibold tracking-wider text-muted-copy uppercase"
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
            onBlur={() => {
              try {
                const normalized = normalizeProxy(proxy, proxyType)
                setProxy(formatProxyForInput(normalized.proxy, normalized.proxyType))
                if (normalized.proxyType) setProxyType(normalized.proxyType)
              } catch {
                /* Keep invalid input for submit validation. */
              }
            }}
            className="h-10 brand-focus border-line bg-field font-mono text-sm text-ink"
          />
          <p className="ml-1 text-[10px] text-subtle-copy">
            Format: <span className="font-mono">host:port:user:pass</span> or{' '}
            <span className="font-mono">host:port</span>
          </p>
        </div>

        {purpose === 'work' && (
          <div className="grid gap-1.5">
            <Label
              htmlFor="proxy-limit"
              className="text-xs font-semibold tracking-wider text-muted-copy uppercase"
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
              className="h-10 brand-focus border-line bg-field font-medium text-ink"
            />
            <p className="ml-1 text-[10px] text-subtle-copy">
              How many profiles can use this proxy.
            </p>
          </div>
        )}
      </div>

      {localError && (
        <div className="mb-4 rounded-md border border-status-danger-border bg-status-danger-soft p-3 text-sm font-medium text-status-danger">
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
