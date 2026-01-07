import { useState, useEffect } from 'react'
import type { Profile } from './types'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Fingerprint, Loader2 } from "lucide-react"
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

// Parse fingerprint JSON to extract display info
function getFingerprintSummary(fingerprintJson?: string): { platform: string; screen: string; webgl: string } | null {
  if (!fingerprintJson) return null
  try {
    const fp = JSON.parse(fingerprintJson)
    return {
      platform: fp.navigator?.platform || 'Unknown',
      screen: fp.screen ? `${fp.screen.width}x${fp.screen.height}` : 'Unknown',
      webgl: fp.videoCard?.renderer?.substring(0, 50) || 'Unknown',
    }
  } catch {
    return null
  }
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
    ...initialData,
  })

  // OS selection for fingerprint generation
  const [selectedOs, setSelectedOs] = useState<'windows' | 'macos' | 'linux'>('windows')
  const [generatingFingerprint, setGeneratingFingerprint] = useState(false)

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

  const handleGenerateFingerprint = async () => {
    setGeneratingFingerprint(true)
    setLocalError(null)

    try {
      const response = await fetch('/api/profiles/generate-fingerprint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ os: selectedOs }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate fingerprint')
      }

      // Store fingerprint as JSON string
      setDraft((prev) => ({
        ...prev,
        fingerprint: JSON.stringify(data.fingerprint),
      }))
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to generate fingerprint')
    } finally {
      setGeneratingFingerprint(false)
    }
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

  const fingerprintSummary = getFingerprintSummary(draft.fingerprint)

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
                value={selectedOs}
                onValueChange={(value) => setSelectedOs(value as 'windows' | 'macos' | 'linux')}
                disabled={saving || generatingFingerprint}
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
                onClick={handleGenerateFingerprint}
                disabled={saving || generatingFingerprint}
                className="flex items-center gap-2"
              >
                {generatingFingerprint ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Fingerprint className="h-4 w-4" />
                )}
                {draft.fingerprint ? 'Regenerate' : 'Generate'} Fingerprint
              </Button>
            </div>

            {fingerprintSummary && (
              <div className="text-xs text-muted-foreground space-y-1 font-mono">
                <div><span className="text-foreground">Platform:</span> {fingerprintSummary.platform}</div>
                <div><span className="text-foreground">Screen:</span> {fingerprintSummary.screen}</div>
                <div><span className="text-foreground">WebGL:</span> {fingerprintSummary.webgl}...</div>
              </div>
            )}

            {!draft.fingerprint && (
              <p className="text-xs text-muted-foreground">
                Generate a fingerprint to enable anti-detection features. Using Camoufox (Firefox-based).
              </p>
            )}
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
