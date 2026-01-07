import { useState, useEffect } from 'react'
import type { Profile } from './types'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Fingerprint, RefreshCw } from "lucide-react"
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
      finalData.proxy_type = undefined;
    }

    setLocalError(null)
    onSave(finalData)
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
          <Label>Browser Fingerprint</Label>
          <div className="p-4 border rounded-md bg-muted/20 space-y-3">
            <div className="flex items-center gap-3">
              <Select
                value={draft.fingerprint_os || 'windows'}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, fingerprint_os: value }))}
                disabled={saving}
              >
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="OS" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="windows">Windows</SelectItem>
                  <SelectItem value="macos">macOS</SelectItem>
                  <SelectItem value="linux">Linux</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                onClick={handleRegenerateSeed}
                disabled={saving}
                className="flex items-center gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Regenerate Seed
              </Button>
            </div>

            {draft.fingerprint_seed && (
              <div className="text-xs text-muted-foreground font-mono flex items-center gap-2">
                <Fingerprint className="h-4 w-4" />
                <span className="text-foreground">Seed:</span>
                <span className="bg-muted px-2 py-1 rounded">{draft.fingerprint_seed}</span>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Fingerprint is generated from seed on each browser launch. Same seed = same fingerprint.
              Uses Camoufox with BrowserForge for anti-detection.
            </p>
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
