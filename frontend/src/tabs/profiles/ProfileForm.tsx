import { useState, useEffect } from 'react'
import type { Profile } from './types'
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Fingerprint, RefreshCw, Globe, Shield, Target } from "lucide-react"
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
  className
}: ProfileFormProps) {
  const [draft, setDraft] = useState<Partial<Profile>>({
    name: '',
    test_ip: false,
    automation: false,
    login: false,
    using: false,
    status: 'idle',
    proxy_type: 'http',
    fingerprint_os: 'windows',
    ...initialData,
  })

  // Connection state: 'direct' or 'proxy'
  const [connection, setConnection] = useState<'direct' | 'proxy'>(
    initialData?.proxy ? 'proxy' : 'direct'
  )

  const [localError, setLocalError] = useState<string | null>(null)

  // Update draft when initialData changes
  useEffect(() => {
    if (initialData) {
      setDraft((prev) => ({ ...prev, ...initialData }))
      setConnection(initialData.proxy ? 'proxy' : 'direct')
    }
  }, [initialData])

  // Generate seed on create mode if not present
  useEffect(() => {
    if (mode === 'create' && !draft.fingerprint_seed) {
      setDraft((prev) => ({ ...prev, fingerprint_seed: generateSeed() }))
    }
  }, [mode, draft.fingerprint_seed])

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

    // Validate: automation=false requires proxy
    const hasProxy = connection === 'proxy' && finalData.proxy && finalData.proxy.trim()
    if (finalData.automation === false && !hasProxy) {
      setLocalError('Proxy is required when automation is disabled (for scraping)')
      return
    }

    setLocalError(null)
    onSave(finalData)
  }

  return (
    <div className={cn("flex flex-col h-[calc(90vh-10rem)]", className)}>
      {/* Scrollable form body */}
      <ScrollArea className="flex-1 min-h-0 pr-4">
        <div className="grid gap-5 pb-2">
        <div className="grid gap-1.5">
          <Label htmlFor="name" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Profile Name</Label>
          <Input
            id="name"
            value={String(draft.name ?? '')}
            onChange={(e) => {
              setDraft((prev) => ({ ...prev, name: e.target.value }))
              setLocalError(null)
            }}
            disabled={saving}
            placeholder="e.g. Work Account 1"
            className="h-9 font-medium"
          />
        </div>

        <Separator />

        <div className="grid gap-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Globe className="h-4 w-4" /> Network Connection
            </Label>
            <Select
              value={connection}
              onValueChange={(value) => setConnection(value as 'direct' | 'proxy')}
              disabled={saving}
            >
              <SelectTrigger id="connection" className="w-[180px] h-8 text-xs">
                <SelectValue placeholder="Select connection" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="direct">Direct Connection</SelectItem>
                <SelectItem value="proxy">Proxy</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {connection === 'proxy' && (
            <div className="animate-in fade-in slide-in-from-top-1 duration-200">
              <div className="flex rounded-md shadow-sm">
                <div className="relative">
                  <Select
                    value={String(draft.proxy_type ?? 'http')}
                    onValueChange={(value) => setDraft((prev) => ({ ...prev, proxy_type: value }))}
                    disabled={saving}
                  >
                    <SelectTrigger id="proxy_type" className="h-9 w-[100px] rounded-r-none border-r-0 focus:ring-0 focus:ring-offset-0 bg-muted/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="http">HTTP</SelectItem>
                      <SelectItem value="socks5">SOCKS5</SelectItem>
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
                    className="h-9 rounded-l-none font-mono text-sm focus-visible:ring-1 focus-visible:ring-offset-0"
                  />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5 ml-1">
                Format: <span className="font-mono">host:port:user:pass</span> or <span className="font-mono">host:port</span>
              </p>
            </div>
          )}
        </div>

        <Separator />

        <div className="grid gap-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Fingerprint className="h-4 w-4" /> Browser Fingerprint
            </Label>
          </div>

          <div className="p-4 border rounded-md bg-card space-y-4">
            <div className="flex items-end gap-4">
              <div className="grid gap-1.5 flex-1">
                <Label className="text-xs text-muted-foreground">Operating System</Label>
                <Select
                  value={draft.fingerprint_os || 'windows'}
                  onValueChange={(value) => setDraft((prev) => ({ ...prev, fingerprint_os: value }))}
                  disabled={saving}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="OS" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="windows">Windows</SelectItem>
                    <SelectItem value="macos">macOS</SelectItem>
                    <SelectItem value="linux">Linux</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleRegenerateSeed}
                disabled={saving}
                className="h-9"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-2" />
                New Seed
              </Button>
            </div>

            {draft.fingerprint_seed && (
              <div className="flex items-center gap-2 text-xs bg-muted/50 p-2 rounded border border-border/50">
                <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-mono text-muted-foreground truncate flex-1">{draft.fingerprint_seed}</span>
              </div>
            )}
          </div>
        </div>

        <Separator />

        <div className="flex items-center justify-between py-2">
          <Label htmlFor="automation" className="cursor-pointer flex flex-col gap-0.5">
            <span className="font-medium">Automation Mode</span>
            <span className="text-xs text-muted-foreground font-normal">Enable additional scraping protections</span>
          </Label>
          <Checkbox
            id="automation"
            checked={Boolean(draft.automation)}
            onCheckedChange={(checked) => setDraft((prev) => ({ ...prev, automation: Boolean(checked) }))}
            disabled={saving}
          />
        </div>

        {draft.automation === false && (
          <div className="animate-in fade-in slide-in-from-top-1 duration-200">
            <Separator className="mb-4" />
            <div className="grid gap-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Target className="h-4 w-4" /> Daily Scraping Limit
                </Label>
              </div>
              <div className="p-4 border rounded-md bg-card space-y-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="daily_scraping_limit" className="text-xs text-muted-foreground">
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
                        daily_scraping_limit: val === '' ? null : Math.max(0, Math.floor(Number(val)))
                      }))
                    }}
                    disabled={saving}
                    placeholder="Leave empty for unlimited"
                    className="h-9"
                  />
                  <p className="text-[10px] text-muted-foreground ml-1">
                    Set a daily limit to prevent overuse. Leave empty for no limit.
                  </p>
                </div>
                {typeof draft.daily_scraping_used === 'number' && draft.daily_scraping_used > 0 && (
                  <div className="text-xs bg-muted/50 p-2 rounded border border-border/50">
                    <span className="text-muted-foreground">Used today: </span>
                    <span className="font-semibold">{draft.daily_scraping_used}</span>
                    {typeof draft.daily_scraping_limit === 'number' && (
                      <span className="text-muted-foreground"> / {draft.daily_scraping_limit}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        </div>
      </ScrollArea>

      {/* Fixed footer with error and buttons */}
      <div className="flex-shrink-0 pt-4 border-t mt-4">
        {localError && (
          <div className="text-sm text-destructive font-medium bg-destructive/10 p-3 rounded-md mb-4">{localError}</div>
        )}

        <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Profile'}
        </Button>
        </div>
      </div>
    </div>
  )
}
