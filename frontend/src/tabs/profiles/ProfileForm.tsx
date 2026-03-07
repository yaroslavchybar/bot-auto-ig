import { useState, useEffect } from 'react'
import type { Profile } from './types'
import { Button } from "@/components/ui/button"
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
      finalData.proxy_type = '';
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
            <Label htmlFor="name" className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Profile Name</Label>
            <Input
              id="name"
              value={String(draft.name ?? '')}
              onChange={(e) => {
                setDraft((prev) => ({ ...prev, name: e.target.value }))
                setLocalError(null)
              }}
              disabled={saving}
              placeholder="e.g. Work Account 1"
              className="h-9 font-medium bg-black/50 border-white/10 text-white focus-visible:ring-red-500/50 focus-visible:border-red-500"
            />
          </div>

          <Separator className="bg-white/5" />

          <div className="grid gap-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium flex items-center gap-2 text-gray-300">
                <Globe className="h-4 w-4" /> Network Connection
              </Label>
              <Select
                value={connection}
                onValueChange={(value) => setConnection(value as 'direct' | 'proxy')}
                disabled={saving}
              >
                <SelectTrigger id="connection" className="w-[180px] h-8 text-xs bg-black/50 border-white/10 text-white focus:ring-red-500/50">
                  <SelectValue placeholder="Select connection" />
                </SelectTrigger>
                <SelectContent className="bg-[#0f0f0f] border-white/10 text-gray-200">
                  <SelectItem value="direct" className="focus:bg-white/10 focus:text-white cursor-pointer">Direct Connection</SelectItem>
                  <SelectItem value="proxy" className="focus:bg-white/10 focus:text-white cursor-pointer">Proxy</SelectItem>
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
                      <SelectTrigger id="proxy_type" className="h-9 w-[100px] rounded-r-none border-r-0 focus:ring-0 focus:ring-offset-0 bg-white/5 border-white/10 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-[#0f0f0f] border-white/10 text-gray-200">
                        <SelectItem value="http" className="focus:bg-white/10 focus:text-white cursor-pointer">HTTP</SelectItem>
                        <SelectItem value="socks5" className="focus:bg-white/10 focus:text-white cursor-pointer">SOCKS5</SelectItem>
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
                      className="h-9 rounded-l-none font-mono text-sm focus-visible:ring-1 focus-visible:ring-offset-0 bg-black/50 border-white/10 text-white focus-visible:ring-red-500/50 focus-visible:border-red-500"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-gray-500 mt-1.5 ml-1">
                  Format: <span className="font-mono">host:port:user:pass</span> or <span className="font-mono">host:port</span>
                </p>
              </div>
            )}
          </div>

          <Separator className="bg-white/5" />

          <div className="grid gap-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium flex items-center gap-2 text-gray-300">
                <Fingerprint className="h-4 w-4" /> Browser Fingerprint
              </Label>
            </div>

            <div className="p-4 rounded-md bg-white/[0.02] border-white/5 border space-y-4">
              <div className="flex items-end gap-4">
                <div className="grid gap-1.5 flex-1">
                  <Label className="text-xs text-gray-400">Operating System</Label>
                  <Select
                    value={draft.fingerprint_os || 'windows'}
                    onValueChange={(value) => setDraft((prev) => ({ ...prev, fingerprint_os: value }))}
                    disabled={saving}
                  >
                    <SelectTrigger className="h-9 bg-black/50 border-white/10 text-white focus:ring-red-500/50">
                      <SelectValue placeholder="OS" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0f0f0f] border-white/10 text-gray-200">
                      <SelectItem value="windows" className="focus:bg-white/10 focus:text-white cursor-pointer">Windows</SelectItem>
                      <SelectItem value="macos" className="focus:bg-white/10 focus:text-white cursor-pointer">macOS</SelectItem>
                      <SelectItem value="linux" className="focus:bg-white/10 focus:text-white cursor-pointer">Linux</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  onClick={handleRegenerateSeed}
                  disabled={saving}
                  className="h-9 bg-transparent border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition-all shadow-none"
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-2" />
                  New Seed
                </Button>
              </div>

              {draft.fingerprint_seed && (
                <div className="flex items-center gap-2 text-xs bg-black/30 p-2 rounded border border-white/5">
                  <Shield className="h-3.5 w-3.5 text-gray-500" />
                  <span className="font-mono text-gray-400 truncate flex-1">{draft.fingerprint_seed}</span>
                </div>
              )}
            </div>
          </div>

          <Separator className="bg-white/5" />

          <div className="grid gap-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium flex items-center gap-2 text-gray-300">
                <Target className="h-4 w-4" /> Daily Scraping Limit
              </Label>
            </div>
            <div className="p-4 rounded-md bg-white/[0.02] border-white/5 border space-y-3">
              <div className="grid gap-1.5">
                <Label htmlFor="daily_scraping_limit" className="text-xs text-gray-400">
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
                  className="h-9 bg-black/50 border-white/10 text-white focus-visible:ring-red-500/50 focus-visible:border-red-500"
                />
                <p className="text-[10px] text-gray-500 ml-1">
                  Controls how much scraping capacity this profile can contribute each day. Leave empty for no limit.
                </p>
              </div>
              {typeof draft.daily_scraping_used === 'number' && draft.daily_scraping_used > 0 && (
                <div className="text-xs bg-black/30 p-2 rounded border border-white/5">
                  <span className="text-gray-500">Used today: </span>
                  <span className="font-semibold text-gray-200">{draft.daily_scraping_used}</span>
                  {typeof draft.daily_scraping_limit === 'number' && (
                    <span className="text-gray-500"> / {draft.daily_scraping_limit}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </ScrollArea>

      {/* Fixed footer with error and buttons */}
      <div className="flex-shrink-0 pt-4 border-t border-white/10 mt-4">
        {localError && (
          <div className="text-sm text-red-500 font-medium bg-red-500/10 p-3 rounded-md mb-4 border border-red-500/20">{localError}</div>
        )}

        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onCancel} disabled={saving} className="bg-transparent border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition-all shadow-none">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="border-none bg-gradient-to-r from-red-600 to-orange-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)] hover:shadow-[0_0_25px_rgba(239,68,68,0.6)] hover:from-red-500 hover:to-orange-400 transition-all font-medium">
            {saving ? 'Saving...' : 'Save Profile'}
          </Button>
        </div>
      </div>
    </div>
  )
}
