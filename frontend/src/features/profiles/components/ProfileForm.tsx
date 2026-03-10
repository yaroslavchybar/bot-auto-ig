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
import { Fingerprint, RefreshCw, Globe, Shield, Target } from 'lucide-react'
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

// Generate a random seed string
function generateSeed(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

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
    test_ip: false,
    login: false,
    using: false,
    status: 'idle',
    proxy_type: 'http',
    fingerprint_os: 'windows',
    ...initialData,
  }))

  // Connection state: 'direct' or 'proxy'
  const [connection, setConnection] = useState<'direct' | 'proxy'>(
    initialData?.proxy ? 'proxy' : 'direct',
  )

  const [localError, setLocalError] = useState<string | null>(null)

  const handleRegenerateSeed = () => {
    setDraft((prev) => ({ ...prev, fingerprint_seed: generateSeed() }))
  }

  const handleSave = () => {
    const name = String(draft.name ?? '').trim()

    if (!name) {
      setLocalError('Name is required')
      return
    }

    // Check conflict
    const isSameName = mode === 'edit' && initialData?.name === name
    if (!isSameName && existingNames.includes(name)) {
      setLocalError('Name already exists')
      return
    }

    // Prepare final data
    const finalData = {
      ...draft,
      name,
      fingerprint_seed:
        draft.fingerprint_seed ||
        (mode === 'create' ? generateSeed() : draft.fingerprint_seed),
    }
    const normalizedCookies = normalizeCookiesJsonForForm(
      String(finalData.cookies_json ?? ''),
    )
    if (normalizedCookies.error) {
      setLocalError(normalizedCookies.error)
      return
    }
    finalData.cookies_json = normalizedCookies.normalized || undefined

    if (connection === 'proxy' && finalData.proxy) {
      const pType = finalData.proxy_type || 'http'
      let pVal = finalData.proxy
      if (pVal.includes('://')) pVal = pVal.split('://')[1]!
      finalData.proxy = `${pType}://${pVal}`
    } else if (connection === 'direct') {
      finalData.proxy = ''
      finalData.proxy_type = ''
    }

    setLocalError(null)
    onSave(finalData)
  }

  return (
    <div className={cn('flex h-[calc(90vh-10rem)] flex-col', className)}>
      {/* Scrollable form body */}
      <ScrollArea className="min-h-0 flex-1 pr-4">
        <div className="grid gap-5 pb-2">
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

          <Separator className="bg-panel-muted" />

          <div className="grid gap-4">
            <div className="flex items-center justify-between">
              <Label className="text-copy flex items-center gap-2 text-sm font-medium">
                <Shield className="h-4 w-4" /> Browser Cookies
              </Label>
            </div>
            <div className="bg-panel-subtle border-line-soft space-y-3 rounded-md border p-4">
              <div className="grid gap-1.5">
                <Label
                  htmlFor="cookies_json"
                  className="text-muted-copy text-xs"
                >
                  Cookies JSON
                </Label>
                <Textarea
                  id="cookies_json"
                  value={String(draft.cookies_json ?? '')}
                  onChange={(e) => {
                    setDraft((prev) => ({
                      ...prev,
                      cookies_json: e.target.value,
                    }))
                    setLocalError(null)
                  }}
                  onBlur={() => {
                    const result = normalizeCookiesJsonForForm(
                      String(draft.cookies_json ?? ''),
                    )
                    if (result.error) {
                      setLocalError(result.error)
                      return
                    }
                    setLocalError(null)
                    setDraft((prev) => ({
                      ...prev,
                      cookies_json: result.normalized || undefined,
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

          <Separator className="bg-panel-muted" />

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
              <div>
                <div className="flex rounded-md shadow-xs">
                  <div className="relative">
                    <Select
                      value={String(draft.proxy_type ?? 'http')}
                      onValueChange={(value) =>
                        setDraft((prev) => ({ ...prev, proxy_type: value }))
                      }
                      disabled={saving}
                    >
                      <SelectTrigger
                        id="proxy_type"
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
            )}
          </div>

          <Separator className="bg-panel-muted" />

          <div className="grid gap-4">
            <div className="flex items-center justify-between">
              <Label className="text-copy flex items-center gap-2 text-sm font-medium">
                <Fingerprint className="h-4 w-4" /> Browser Fingerprint
              </Label>
            </div>

            <div className="bg-panel-subtle border-line-soft space-y-4 rounded-md border p-4">
              <div className="flex items-end gap-4">
                <div className="grid flex-1 gap-1.5">
                  <Label className="text-muted-copy text-xs">
                    Operating System
                  </Label>
                  <Select
                    value={draft.fingerprint_os || 'windows'}
                    onValueChange={(value) =>
                      setDraft((prev) => ({ ...prev, fingerprint_os: value }))
                    }
                    disabled={saving}
                  >
                    <SelectTrigger className="brand-focus bg-field border-line h-9 text-ink">
                      <SelectValue placeholder="OS" />
                    </SelectTrigger>
                    <SelectContent className="panel-dropdown">
                      <SelectItem
                        value="windows"
                        className="focus:bg-panel-hover cursor-pointer focus:text-ink"
                      >
                        Windows
                      </SelectItem>
                      <SelectItem
                        value="macos"
                        className="focus:bg-panel-hover cursor-pointer focus:text-ink"
                      >
                        macOS
                      </SelectItem>
                      <SelectItem
                        value="linux"
                        className="focus:bg-panel-hover cursor-pointer focus:text-ink"
                      >
                        Linux
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  onClick={handleRegenerateSeed}
                  disabled={saving}
                  className="h-9"
                >
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  New Seed
                </Button>
              </div>

              {draft.fingerprint_seed && (
                <div className="bg-panel-muted border-line-soft flex items-center gap-2 rounded-sm border p-2 text-xs">
                  <Shield className="text-subtle-copy h-3.5 w-3.5" />
                  <span className="text-muted-copy flex-1 truncate font-mono">
                    {draft.fingerprint_seed}
                  </span>
                </div>
              )}
            </div>
          </div>

          <Separator className="bg-panel-muted" />

          <div className="grid gap-4">
            <div className="flex items-center justify-between">
              <Label className="text-copy flex items-center gap-2 text-sm font-medium">
                <Target className="h-4 w-4" /> Daily Scraping Limit
              </Label>
            </div>
            <div className="bg-panel-subtle border-line-soft space-y-3 rounded-md border p-4">
              <div className="grid gap-1.5">
                <Label
                  htmlFor="daily_scraping_limit"
                  className="text-muted-copy text-xs"
                >
                  Maximum items to scrape per day
                </Label>
                <Input
                  id="daily_scraping_limit"
                  type="number"
                  min="0"
                  step="1"
                  value={draft.daily_scraping_limit ?? ''}
                  onChange={(e) => {
                    const val = e.target.value.trim()
                    setDraft((prev) => ({
                      ...prev,
                      daily_scraping_limit:
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
              {typeof draft.daily_scraping_used === 'number' &&
                draft.daily_scraping_used > 0 && (
                  <div className="bg-panel-muted border-line-soft rounded-sm border p-2 text-xs">
                    <span className="text-subtle-copy">Used today: </span>
                    <span className="text-ink font-semibold">
                      {draft.daily_scraping_used}
                    </span>
                    {typeof draft.daily_scraping_limit === 'number' && (
                      <span className="text-subtle-copy">
                        {' '}
                        / {draft.daily_scraping_limit}
                      </span>
                    )}
                  </div>
                )}
            </div>
          </div>
        </div>
      </ScrollArea>

      {/* Fixed footer with error and buttons */}
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
            onClick={handleSave}
            disabled={saving}
            className="brand-button font-medium"
          >
            {saving ? 'Saving...' : 'Save Profile'}
          </Button>
        </div>
      </div>
    </div>
  )
}



