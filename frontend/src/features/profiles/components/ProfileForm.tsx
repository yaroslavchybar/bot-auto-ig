import { useState } from 'react'
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
import { Fingerprint, Globe, Shield, Target, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { normalizeCookiesJsonForForm } from '../utils/cookieJson'

interface ProfileFormProps {
  mode: 'create' | 'edit'
  initialData?: Partial<Profile>
  existingNames: string[]
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
        className="text-muted-copy text-xs font-semibold tracking-wider uppercase"
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
        className="brand-focus bg-field border-line h-9 font-medium text-ink"
      />
    </div>
  )
}

/* ── Cookies Field ── */

function CookiesField({ draft, saving, setDraft, setLocalError }: FieldProps) {
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <Label className="text-copy flex items-center gap-2 text-sm font-medium">
          <Shield className="h-4 w-4" /> Browser Cookies
        </Label>
      </div>
      <div className="bg-panel-subtle border-line-soft space-y-3 rounded-md border p-4">
        <div className="grid gap-1.5">
          <Label
            htmlFor="cookiesJson"
            className="text-muted-copy text-xs"
          >
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
              const result = normalizeCookiesJsonForForm(
                String(draft.cookiesJson ?? ''),
              )
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
            placeholder='Paste raw cookie array or AdsPower-style JSON with a "cookies" array'
            className="brand-focus bg-field border-line min-h-[180px] resize-y font-mono text-xs text-ink"
          />
          <p className="text-subtle-copy ml-1 text-[10px]">
            Accepted formats: raw Playwright cookie arrays and
            AdsPower-style JSON objects with a cookies array.
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
        <Label className="text-copy flex items-center gap-2 text-sm font-medium">
          <Globe className="h-4 w-4" /> Network Connection
        </Label>
        <Select
          value={connection}
          onValueChange={(value) =>
            setConnection(value as 'direct' | 'proxy')
          }
          disabled={saving}
        >
          <SelectTrigger
            id="connection"
            className="brand-focus bg-field border-line h-8 w-[180px] text-xs text-ink"
          >
            <SelectValue placeholder="Select connection" />
          </SelectTrigger>
          <SelectContent className="panel-dropdown">
            <SelectItem
              value="direct"
              className="focus:bg-panel-hover cursor-pointer focus:text-ink"
            >
              Direct Connection
            </SelectItem>
            <SelectItem
              value="proxy"
              className="focus:bg-panel-hover cursor-pointer focus:text-ink"
            >
              Proxy
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {connection === 'proxy' && (
        <ProxyInputRow draft={draft} saving={saving} setDraft={setDraft} />
      )}
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
              setDraft((prev) => ({ ...prev, proxyType: value }))
            }
            disabled={saving}
          >
            <SelectTrigger
              id="proxyType"
              className="bg-panel-muted border-line h-9 w-[100px] rounded-r-none border-r-0 text-ink focus:ring-0 focus:ring-offset-0"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="panel-dropdown">
              <SelectItem
                value="http"
                className="focus:bg-panel-hover cursor-pointer focus:text-ink"
              >
                HTTP
              </SelectItem>
              <SelectItem
                value="socks5"
                className="focus:bg-panel-hover cursor-pointer focus:text-ink"
              >
                SOCKS5
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="relative flex-1">
          <Input
            id="proxy"
            value={String(draft.proxy ?? '')}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, proxy: e.target.value }))
            }
            disabled={saving}
            placeholder="host:port:user:pass"
            className="brand-focus bg-field border-line h-9 rounded-l-none font-mono text-sm text-ink focus-visible:ring-1 focus-visible:ring-offset-0"
          />
        </div>
      </div>
      <p className="text-subtle-copy mt-1.5 ml-1 text-[10px]">
        Format: <span className="font-mono">host:port:user:pass</span>{' '}
        or <span className="font-mono">host:port</span>
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
      <Label className="text-muted-copy text-xs">Operating System</Label>
      <Select value={value} onValueChange={onChange} disabled={saving}>
        <SelectTrigger className="brand-focus bg-field border-line h-9 text-ink">
          <SelectValue placeholder="OS" />
        </SelectTrigger>
        <SelectContent className="panel-dropdown">
          <SelectItem value="windows" className="focus:bg-panel-hover cursor-pointer focus:text-ink">Windows</SelectItem>
          <SelectItem value="macos" className="focus:bg-panel-hover cursor-pointer focus:text-ink">macOS</SelectItem>
          <SelectItem value="linux" className="focus:bg-panel-hover cursor-pointer focus:text-ink">Linux</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

/* ── Fingerprint Fields ── */

function FingerprintFields({
  draft, saving, setDraft,
}: {
  draft: Partial<Profile>; saving: boolean
  setDraft: React.Dispatch<React.SetStateAction<Partial<Profile>>>
}) {
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <Label className="text-copy flex items-center gap-2 text-sm font-medium">
          <Fingerprint className="h-4 w-4" /> Browser Fingerprint
        </Label>
      </div>
      <div className="bg-panel-subtle border-line-soft space-y-4 rounded-md border p-4">
        <OsSelector
          value={draft.fingerprintOs || 'windows'}
          saving={saving}
          onChange={(value) => setDraft((prev) => ({ ...prev, fingerprintOs: value }))}
        />
      </div>
    </div>
  )
}

/* ── Daily Limit Field ── */

function DailyLimitField({
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
        <Label className="text-copy flex items-center gap-2 text-sm font-medium">
          <Target className="h-4 w-4" /> Daily Scraping Limit
        </Label>
      </div>
      <div className="bg-panel-subtle border-line-soft space-y-3 rounded-md border p-4">
        <div className="grid gap-1.5">
          <Label
            htmlFor="dailyScrapingLimit"
            className="text-muted-copy text-xs"
          >
            Maximum items to scrape per day
          </Label>
          <Input
            id="dailyScrapingLimit"
            type="number"
            min="0"
            step="1"
            value={draft.dailyScrapingLimit ?? ''}
            onChange={(e) => {
              const val = e.target.value.trim()
              setDraft((prev) => ({
                ...prev,
                dailyScrapingLimit:
                  val === ''
                    ? null
                    : Math.max(0, Math.floor(Number(val))),
              }))
            }}
            disabled={saving}
            placeholder="Leave empty for unlimited"
            className="brand-focus bg-field border-line h-9 text-ink"
          />
          <p className="text-subtle-copy ml-1 text-[10px]">
            Controls how much scraping capacity this profile can
            contribute each day. Leave empty for no limit.
          </p>
        </div>
        {typeof draft.dailyScrapingUsed === 'number' &&
          draft.dailyScrapingUsed > 0 && (
            <div className="bg-panel-muted border-line-soft rounded-sm border p-2 text-xs">
              <span className="text-subtle-copy">Used today: </span>
              <span className="text-ink font-semibold">
                {draft.dailyScrapingUsed}
              </span>
              {typeof draft.dailyScrapingLimit === 'number' && (
                <span className="text-subtle-copy">
                  {' '}
                  / {draft.dailyScrapingLimit}
                </span>
              )}
            </div>
          )}
      </div>
    </div>
  )
}

function AssignedAccountsLimitField({
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
        <Label className="text-copy flex items-center gap-2 text-sm font-medium">
          <Users className="h-4 w-4" /> Assigned Accounts Limit
        </Label>
      </div>
      <div className="bg-panel-subtle border-line-soft space-y-3 rounded-md border p-4">
        <div className="grid gap-1.5">
          <Label
            htmlFor="assignedAccountsLimit"
            className="text-muted-copy text-xs"
          >
            Maximum assigned accounts for this profile
          </Label>
          <Input
            id="assignedAccountsLimit"
            type="number"
            min="0"
            step="1"
            value={draft.assignedAccountsLimit ?? ''}
            onChange={(e) => {
              const val = e.target.value.trim()
              setDraft((prev) => ({
                ...prev,
                assignedAccountsLimit:
                  val === ''
                    ? null
                    : Math.max(0, Math.floor(Number(val))),
              }))
            }}
            disabled={saving}
            placeholder="10"
            className="brand-focus bg-field border-line h-9 text-ink"
          />
          <p className="text-subtle-copy ml-1 text-[10px]">
            Hard cap for how many accounts can stay assigned to this profile at
            once. Empty saves as the default limit of 10.
          </p>
        </div>
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
    <div className="border-line mt-4 shrink-0 border-t pt-4">
      {localError && (
        <div className="text-status-danger bg-status-danger-soft border-status-danger-border mb-4 rounded-md border p-3 text-sm font-medium">
          {localError}
        </div>
      )}

      <div className="flex justify-end gap-3">
        <Button
          variant="ghost"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          onClick={onSave}
          disabled={saving}
          className="brand-button font-medium"
        >
          {saving ? 'Saving...' : 'Save Profile'}
        </Button>
      </div>
    </div>
  )
}

/* ── Main ProfileForm ── */

export function ProfileForm({
  mode,
  initialData,
  existingNames,
  saving,
  onSave,
  onCancel,
  className,
}: ProfileFormProps) {
  const [draft, setDraft] = useState<Partial<Profile>>(() => ({
    name: '',
    testIp: false,
    login: false,
    using: false,
    status: 'idle',
    proxyType: 'http',
    fingerprintOs: 'windows',
    assignedAccountsLimit: 10,
    ...initialData,
  }))

  const [connection, setConnection] = useState<'direct' | 'proxy'>(
    initialData?.proxy ? 'proxy' : 'direct',
  )
  const [localError, setLocalError] = useState<string | null>(null)

  const handleSave = () => {
    const name = String(draft.name ?? '').trim()
    if (!name) { setLocalError('Name is required'); return }
    const isSameName = mode === 'edit' && initialData?.name === name
    if (!isSameName && existingNames.includes(name)) {
      setLocalError('Name already exists'); return
    }
    const finalData = {
      ...draft,
      name,
      assignedAccountsLimit:
        typeof draft.assignedAccountsLimit === 'number'
          ? Math.max(0, Math.floor(draft.assignedAccountsLimit))
          : 10,
    }
    const normalizedCookies = normalizeCookiesJsonForForm(
      String(finalData.cookiesJson ?? ''),
    )
    if (normalizedCookies.error) { setLocalError(normalizedCookies.error); return }
    finalData.cookiesJson = normalizedCookies.normalized || undefined
    if (connection === 'proxy' && finalData.proxy) {
      const pType = finalData.proxyType || 'http'
      let pVal = finalData.proxy
      if (pVal.includes('://')) pVal = pVal.split('://')[1]!
      finalData.proxy = `${pType}://${pVal}`
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
          <Separator className="bg-panel-muted" />
          <AssignedAccountsLimitField draft={draft} saving={saving} setDraft={setDraft} />
          <Separator className="bg-panel-muted" />
          <DailyLimitField draft={draft} saving={saving} setDraft={setDraft} />
        </div>
      </ScrollArea>
      <FormActions localError={localError} saving={saving} onSave={handleSave} onCancel={onCancel} />
    </div>
  )
}
