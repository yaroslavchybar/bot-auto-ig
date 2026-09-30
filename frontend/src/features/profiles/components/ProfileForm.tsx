import { useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import { proxyUsageKey } from '../../proxies/utils/proxyUsage'
import { useCursorPage, useDebouncedSearch } from '@/hooks/use-cursor-page'
import { PageControls } from '@/components/shared/PageControls'
import type { Profile } from '../types'
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
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { Fingerprint, Globe, Shield } from 'lucide-react'
import { cn } from '@/lib/utils'
import { normalizeCookiesJsonForForm } from '../utils/cookieJson'
import { normalizeProxy } from '../../../../../server/shared/proxy'
import { stripScheme } from '../../proxies/utils/maskProxy'
import { formatProxyForInput } from '../../proxies/utils/formatProxyForInput'

interface ProfileFormProps {
  initialData?: Partial<Profile>
  saving: boolean
  onSave: (data: Partial<Profile>) => void
  onCancel: () => void
  className?: string
}

interface FieldProps {
  draft: Partial<Profile>
  saving: boolean
  setDraft: React.Dispatch<React.SetStateAction<Partial<Profile>>>
  setLocalError: (error: string | null) => void
}

/* ── Profile Name Field ── */

function ProfileNameField({ draft, saving, setDraft, setLocalError }: FieldProps) {
  return (
    <div className="grid gap-1.5">
      <Label
        htmlFor="name"
        className="text-xs font-semibold tracking-wider text-muted-copy uppercase"
      >
        Profile Name
      </Label>
      <Input
        id="name"
        value={String(draft.name ?? '')}
        onChange={(e) => {
          setDraft((prev) => ({ ...prev, name: e.target.value }))
          setLocalError(null)
        }}
        disabled={saving}
        placeholder="e.g. Work Account 1"
        className="h-9 brand-focus border-line bg-field font-medium text-ink"
      />
    </div>
  )
}

/* ── Cookies Field ── */

function CookiesField({ draft, saving, setDraft, setLocalError }: FieldProps) {
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2 text-sm font-medium text-copy">
          <Shield className="h-4 w-4" /> Browser Cookies
        </Label>
      </div>
      <div className="space-y-3 rounded-md border border-line-soft bg-panel-subtle p-4">
        <div className="grid gap-1.5">
          <Label htmlFor="cookiesJson" className="text-xs text-muted-copy">
            Cookies JSON
          </Label>
          <Textarea
            id="cookiesJson"
            value={String(draft.cookiesJson ?? '')}
            onChange={(e) => {
              setDraft((prev) => ({
                ...prev,
                cookiesJson: e.target.value,
              }))
              setLocalError(null)
            }}
            onBlur={() => {
              const result = normalizeCookiesJsonForForm(String(draft.cookiesJson ?? ''))
              if (result.error) {
                setLocalError(result.error)
                return
              }
              setLocalError(null)
              setDraft((prev) => ({
                ...prev,
                cookiesJson: result.normalized || undefined,
              }))
            }}
            disabled={saving}
            placeholder="Paste cookies as JSON, Netscape cookies.txt, or name=value pairs"
            className="min-h-[180px] resize-y brand-focus border-line bg-field font-mono text-xs text-ink"
          />
          <p className="ml-1 text-[10px] text-subtle-copy">
            Accepted: Playwright/AdsPower JSON arrays, Netscape cookies.txt, and document.cookie
            strings. Cookies without a domain default to .instagram.com.
          </p>
        </div>
      </div>
    </div>
  )
}

/* ── Proxy Fields ── */

function ProxyFields({
  draft,
  saving,
  setDraft,
  connection,
  setConnection,
}: FieldProps & {
  connection: 'direct' | 'proxy'
  setConnection: (v: 'direct' | 'proxy') => void
}) {
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2 text-sm font-medium text-copy">
          <Globe className="h-4 w-4" /> Network Connection
        </Label>
        <Select
          value={connection}
          onValueChange={(value) => setConnection(value as 'direct' | 'proxy')}
          disabled={saving}
        >
          <SelectTrigger
            id="connection"
            className="h-8 w-[180px] brand-focus border-line bg-field text-xs text-ink"
          >
            <SelectValue placeholder="Select connection" />
          </SelectTrigger>
          <SelectContent className="panel-dropdown">
            <SelectItem
              value="direct"
              className="cursor-pointer focus:bg-panel-hover focus:text-ink"
            >
              Direct Connection
            </SelectItem>
            <SelectItem
              value="proxy"
              className="cursor-pointer focus:bg-panel-hover focus:text-ink"
            >
              Proxy
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {connection === 'proxy' && (
        <>
          <SavedProxyPicker
            saving={saving}
            setDraft={setDraft}
            currentProxy={draft.proxy}
            currentProxyType={draft.proxyType}
          />
          <ProxyInputRow draft={draft} saving={saving} setDraft={setDraft} />
        </>
      )}
    </div>
  )
}

/* ── Saved Proxy Picker ── */

// Pick from proxies managed on the Proxies page. Fills the manual
// fields below so the stored profile keeps a plain proxy string.
// Options at their profile limit are disabled unless already selected.
function SavedProxyPicker({
  saving,
  setDraft,
  currentProxy,
  currentProxyType,
}: {
  saving: boolean
  setDraft: React.Dispatch<React.SetStateAction<Partial<Profile>>>
  currentProxy?: string
  currentProxyType?: string
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const search = useDebouncedSearch(searchQuery)
  const position = useCursorPage(search)
  const data = useQuery(api.proxies.listPage, { search, cursor: position.cursor, purpose: 'work' })
  const saved = data?.page ?? []
  const currentKey = proxyUsageKey(currentProxy, currentProxyType)
  const selectedId = saved.find(
    (p) => currentKey !== null && proxyUsageKey(p.proxy, p.proxyType) === currentKey,
  )

  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-copy">Saved proxy</Label>
      <Input
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        placeholder="Search saved proxies..."
        aria-label="Search saved proxies"
      />
      <Select
        disabled={saving}
        value={currentKey ?? ''}
        onValueChange={(key) => {
          const found = saved.find((p) => proxyUsageKey(p.proxy, p.proxyType) === key)
          if (!found) return
          setDraft((prev) => ({
            ...prev,
            proxy: formatProxyForInput(found.proxy, found.proxyType),
            proxyType: found.proxyType,
          }))
        }}
      >
        <SelectTrigger className="h-9 brand-focus border-line bg-field text-ink">
          <SelectValue placeholder="Choose a saved proxy...">
            {selectedId?.name ?? (currentKey ? 'Current proxy' : undefined)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="panel-dropdown">
          {saved.map((p) => {
            const limit = typeof p.maxProfiles === 'number' ? p.maxProfiles : 3
            const used = p.usage.count
            const isCurrent =
              currentKey !== null && currentKey === proxyUsageKey(p.proxy, p.proxyType)
            const full = used >= limit && !isCurrent
            return (
              <SelectItem
                key={p._id}
                value={proxyUsageKey(p.proxy, p.proxyType)!}
                disabled={full}
                className="cursor-pointer focus:bg-panel-hover focus:text-ink"
              >
                {p.name} ({p.proxyType}) · {used}/{limit}
                {full ? ' · full' : ''}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
      <PageControls
        {...position}
        loading={data === undefined}
        hasNext={Boolean(data && !data.isDone)}
        next={() => {
          if (data && !data.isDone) position.next(data.continueCursor)
        }}
      />
    </div>
  )
}

/* ── Proxy Input Row ── */

function ProxyInputRow({
  draft,
  saving,
  setDraft,
}: {
  draft: Partial<Profile>
  saving: boolean
  setDraft: React.Dispatch<React.SetStateAction<Partial<Profile>>>
}) {
  return (
    <div>
      <div className="flex rounded-md shadow-xs">
        <div className="relative">
          <Select
            value={String(draft.proxyType ?? 'http')}
            onValueChange={(value) =>
              setDraft((prev) => ({
                ...prev,
                proxyType: value,
                proxy: stripScheme(prev.proxy ?? ''),
              }))
            }
            disabled={saving}
          >
            <SelectTrigger
              id="proxyType"
              className="h-9 w-[100px] rounded-r-none border-r-0 border-line bg-panel-muted text-ink focus:ring-0 focus:ring-offset-0"
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
        <div className="relative flex-1">
          <Input
            id="proxy"
            value={String(draft.proxy ?? '')}
            onChange={(e) => setDraft((prev) => ({ ...prev, proxy: e.target.value }))}
            disabled={saving}
            placeholder="host:port:user:pass"
            onBlur={() => {
              try {
                const normalized = normalizeProxy(draft.proxy, draft.proxyType)
                setDraft((prev) => ({
                  ...prev,
                  proxy: formatProxyForInput(normalized.proxy, normalized.proxyType),
                  proxyType: normalized.proxyType || prev.proxyType,
                }))
              } catch {
                /* Keep invalid input for submit validation. */
              }
            }}
            className="h-9 rounded-l-none brand-focus border-line bg-field font-mono text-sm text-ink focus-visible:ring-1 focus-visible:ring-offset-0"
          />
        </div>
      </div>
      <p className="mt-1.5 ml-1 text-[10px] text-subtle-copy">
        Format: <span className="font-mono">host:port:user:pass</span> or{' '}
        <span className="font-mono">host:port</span>
      </p>
    </div>
  )
}

/* ── Fingerprint Fields ── */

/* ── OS Selector ── */

function OsSelector({
  value,
  saving,
  onChange,
}: {
  value: string
  saving: boolean
  onChange: (v: string) => void
}) {
  return (
    <div className="grid flex-1 gap-1.5">
      <Label className="text-xs text-muted-copy">Operating System</Label>
      <Select value={value} onValueChange={onChange} disabled={saving}>
        <SelectTrigger className="h-9 brand-focus border-line bg-field text-ink">
          <SelectValue placeholder="OS" />
        </SelectTrigger>
        <SelectContent className="panel-dropdown">
          <SelectItem
            value="windows"
            className="cursor-pointer focus:bg-panel-hover focus:text-ink"
          >
            Windows
          </SelectItem>
          <SelectItem value="macos" className="cursor-pointer focus:bg-panel-hover focus:text-ink">
            macOS
          </SelectItem>
          <SelectItem value="linux" className="cursor-pointer focus:bg-panel-hover focus:text-ink">
            Linux
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

/* ── Fingerprint Fields ── */

function FingerprintFields({
  draft,
  saving,
  setDraft,
}: {
  draft: Partial<Profile>
  saving: boolean
  setDraft: React.Dispatch<React.SetStateAction<Partial<Profile>>>
}) {
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2 text-sm font-medium text-copy">
          <Fingerprint className="h-4 w-4" /> Browser Fingerprint
        </Label>
      </div>
      <div className="space-y-4 rounded-md border border-line-soft bg-panel-subtle p-4">
        <OsSelector
          value={draft.fingerprintOs || 'windows'}
          saving={saving}
          onChange={(value) => setDraft((prev) => ({ ...prev, fingerprintOs: value }))}
        />
      </div>
    </div>
  )
}

/* ── Form Actions ── */

function FormActions({
  localError,
  saving,
  onSave,
  onCancel,
}: {
  localError: string | null
  saving: boolean
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="mt-4 shrink-0 border-t border-line pt-4">
      {localError && (
        <div className="mb-4 rounded-md border border-status-danger-border bg-status-danger-soft p-3 text-sm font-medium text-status-danger">
          {localError}
        </div>
      )}

      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={onSave} disabled={saving} className="brand-button font-medium">
          {saving ? 'Saving...' : 'Save Profile'}
        </Button>
      </div>
    </div>
  )
}

/* ── Main ProfileForm ── */

export function ProfileForm({
  initialData,
  saving,
  onSave,
  onCancel,
  className,
}: ProfileFormProps) {
  const [draft, setDraft] = useState<Partial<Profile>>(() => ({
    name: '',
    using: false,
    status: 'idle',
    proxyType: 'http',
    fingerprintOs: 'windows',
    ...initialData,
    proxy: formatProxyForInput(initialData?.proxy, initialData?.proxyType),
  }))

  const [connection, setConnection] = useState<'direct' | 'proxy'>(
    initialData?.proxy ? 'proxy' : 'direct',
  )
  const [localError, setLocalError] = useState<string | null>(null)

  const handleSave = () => {
    const name = String(draft.name ?? '').trim()
    if (!name) {
      setLocalError('Name is required')
      return
    }
    const finalData = {
      ...draft,
      name,
    }
    const normalizedCookies = normalizeCookiesJsonForForm(String(finalData.cookiesJson ?? ''))
    if (normalizedCookies.error) {
      setLocalError(normalizedCookies.error)
      return
    }
    finalData.cookiesJson = normalizedCookies.normalized || undefined
    if (connection === 'proxy') {
      try {
        const normalized = normalizeProxy(finalData.proxy, finalData.proxyType)
        if (!normalized.proxy) {
          setLocalError('Proxy is required')
          return
        }
        Object.assign(finalData, normalized)
      } catch {
        setLocalError('Invalid proxy URL or protocol')
        return
      }
    } else if (connection === 'direct') {
      finalData.proxy = ''
      finalData.proxyType = ''
    }
    setLocalError(null)
    onSave(finalData)
  }

  const fieldProps: FieldProps = { draft, saving, setDraft, setLocalError }

  return (
    <div className={cn('flex h-[calc(90vh-10rem)] flex-col', className)}>
      <ScrollArea className="min-h-0 flex-1 pr-4">
        <div className="grid gap-5 pb-2">
          <ProfileNameField {...fieldProps} />
          <Separator className="bg-panel-muted" />
          <CookiesField {...fieldProps} />
          <Separator className="bg-panel-muted" />
          <ProxyFields {...fieldProps} connection={connection} setConnection={setConnection} />
          <Separator className="bg-panel-muted" />
          <FingerprintFields draft={draft} saving={saving} setDraft={setDraft} />
        </div>
      </ScrollArea>
      <FormActions
        localError={localError}
        saving={saving}
        onSave={handleSave}
        onCancel={onCancel}
      />
    </div>
  )
}
