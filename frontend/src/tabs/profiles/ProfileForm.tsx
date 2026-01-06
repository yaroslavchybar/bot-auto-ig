import { useState, useEffect } from 'react'
import type { Profile } from './types'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"

interface ProfileFormProps {
  mode: 'create' | 'edit'
  initialData?: Partial<Profile>
  existingNames: string[]
  saving: boolean
  onSave: (data: Partial<Profile>) => void
  onCancel: () => void
  className?: string
}

// UA Constants (copied from source/lib/user_agents.ts)
const firefoxUas = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
  "Mozilla/5.0 (Windows NT 11.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:122.0) Gecko/20100101 Firefox/122.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (X11; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (X11; Linux x86_64; rv:122.0) Gecko/20100101 Firefox/122.0",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0",
]

const chromeUas = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
]

const safariUas = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
]

function getRandomUserAgent(os?: string, browser?: string): string {
  let candidates: string[] = []

  if (browser === 'Chrome') candidates = chromeUas
  else if (browser === 'Safari') candidates = safariUas
  else candidates = firefoxUas // Default to Firefox

  let filtered = candidates
  if (os === 'Windows') filtered = candidates.filter((ua) => ua.includes('Windows'))
  else if (os === 'macOS') filtered = candidates.filter((ua) => ua.includes('Macintosh'))
  else if (os === 'Linux') filtered = candidates.filter((ua) => ua.includes('Linux') || ua.includes('X11'))

  if (filtered.length === 0) filtered = candidates

  return filtered[Math.floor(Math.random() * filtered.length)]
}

export function ProfileForm({
  mode,
  initialData,
  existingNames,
  saving,
  onSave,
  onCancel,
  className
}: ProfileFormProps) {
  const [draft, setDraft] = useState<Partial<Profile>>({
    name: '',
    type: 'Camoufox (рекомендуется)',
    test_ip: false,
    login: false,
    using: false,
    status: 'idle',
    ua_os: 'Любая',
    ua_browser: 'Firefox',
    proxy_type: 'http',
    ...initialData,
    user_agent: initialData?.user_agent || getRandomUserAgent(initialData?.ua_os || 'Любая', initialData?.ua_browser || 'Firefox'),
  })

  // Connection state: 'direct' or 'proxy'
  // If initialData has a proxy set, assume 'proxy', otherwise 'direct'
  const [connection, setConnection] = useState<'direct' | 'proxy'>(
    initialData?.proxy ? 'proxy' : 'direct'
  )

  const [localError, setLocalError] = useState<string | null>(null)

  // Update draft when initialData changes
  /* eslint-disable react-hooks/set-state-in-effect -- syncing with prop changes is legitimate */
  useEffect(() => {
    if (initialData) {
      setDraft((prev) => ({ ...prev, ...initialData }))
      setConnection(initialData.proxy ? 'proxy' : 'direct')
    }
  }, [initialData])
  /* eslint-enable react-hooks/set-state-in-effect */

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
    const finalData = { ...draft, name }

    if (connection === 'proxy' && finalData.proxy) {
      const pType = finalData.proxy_type || 'http';
      let pVal = finalData.proxy;
      if (pVal.includes('://')) pVal = pVal.split('://')[1]!;
      finalData.proxy = `${pType}://${pVal}`;
    } else if (connection === 'direct') {
      finalData.proxy = '';
      finalData.proxy_type = undefined;
    }

    setLocalError(null)
    onSave(finalData)
  }

  const handleRegenUA = () => {
    const ua = getRandomUserAgent(draft.ua_os, draft.ua_browser)
    setDraft((prev) => ({ ...prev, user_agent: ua }))
  }

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={String(draft.name ?? '')}
            onChange={(e) => {
              setDraft((prev) => ({ ...prev, name: e.target.value }))
              setLocalError(null)
            }}
            disabled={saving}
            placeholder="Profile name"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="type">Browser Type</Label>
          <Select
            value={String(draft.type ?? 'Camoufox (рекомендуется)')}
            onValueChange={(value) => setDraft((prev) => ({ ...prev, type: value }))}
            disabled={saving}
          >
            <SelectTrigger id="type">
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Camoufox (рекомендуется)">Camoufox (Recommended)</SelectItem>
              <SelectItem value="Standard Firefox">Standard Firefox</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="connection">Connection</Label>
          <Select
            value={connection}
            onValueChange={(value) => setConnection(value as 'direct' | 'proxy')}
            disabled={saving}
          >
            <SelectTrigger id="connection">
              <SelectValue placeholder="Select connection" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="direct">Direct Connection</SelectItem>
              <SelectItem value="proxy">Proxy</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {connection === 'proxy' && (
          <div className="grid gap-2 p-4 border rounded-md bg-muted/20">
            <div className="grid gap-2">
              <Label htmlFor="proxy_type">Proxy Type</Label>
              <Select
                value={String(draft.proxy_type ?? 'http')}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, proxy_type: value }))}
                disabled={saving}
              >
                <SelectTrigger id="proxy_type">
                  <SelectValue placeholder="Select proxy type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="http">HTTP</SelectItem>
                  <SelectItem value="socks5">SOCKS5</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="proxy">Proxy Address</Label>
              <Input
                id="proxy"
                value={String(draft.proxy ?? '')}
                onChange={(e) => setDraft((prev) => ({ ...prev, proxy: e.target.value }))}
                disabled={saving}
                placeholder="ip:port:user:pass"
              />
            </div>
          </div>
        )}

        <div className="grid gap-2">
          <Label>User Agent Settings</Label>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="ua_os" className="text-xs text-muted-foreground">OS</Label>
              <Select
                value={String(draft.ua_os ?? 'Любая')}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, ua_os: value }))}
                disabled={saving}
              >
                <SelectTrigger id="ua_os">
                  <SelectValue placeholder="Select OS" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Любая">Any</SelectItem>
                  <SelectItem value="Windows">Windows</SelectItem>
                  <SelectItem value="macOS">macOS</SelectItem>
                  <SelectItem value="Linux">Linux</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ua_browser" className="text-xs text-muted-foreground">Browser</Label>
              <Select
                value={String(draft.ua_browser ?? 'Firefox')}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, ua_browser: value }))}
                disabled={saving}
              >
                <SelectTrigger id="ua_browser">
                  <SelectValue placeholder="Select browser" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Firefox">Firefox</SelectItem>
                  <SelectItem value="Chrome">Chrome</SelectItem>
                  <SelectItem value="Safari">Safari</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="user_agent">User Agent String</Label>
          <div className="flex gap-2">
            <Input
              id="user_agent"
              value={String(draft.user_agent ?? '')}
              onChange={(e) => setDraft((prev) => ({ ...prev, user_agent: e.target.value }))}
              disabled={saving}
              className="font-mono text-xs"
            />
            <Button type="button" variant="outline" size="icon" onClick={handleRegenUA} disabled={saving} title="Regenerate UA">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {localError && (
        <div className="text-sm text-destructive font-medium">{localError}</div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  )
}
