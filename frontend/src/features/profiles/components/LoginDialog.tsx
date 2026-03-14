import { useState, useEffect, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2, Play, Terminal, Smartphone } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import type { LogEntry } from '@/lib/logs'
import type { Profile } from '../types'
import { cn } from '@/lib/utils'

interface LoginDialogProps {
  open: boolean
  profile: Profile | null
  logs: LogEntry[]
  onClose: () => void
  onSuccess: () => void
}

/* ── Login Form Content ── */

/* ── Username + Password fields ── */

function LoginCredentialFields({
  username,
  password,
  loading,
  onUsernameChange,
  onPasswordChange,
}: {
  username: string
  password: string
  loading: boolean
  onUsernameChange: (v: string) => void
  onPasswordChange: (v: string) => void
}) {
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="login-username" className="text-muted-copy">
          Instagram Username
        </Label>
        <Input
          id="login-username"
          value={username}
          onChange={(e) => onUsernameChange(e.target.value)}
          placeholder="username"
          disabled={loading}
          autoComplete="off"
          className="brand-focus bg-field border-line h-9 text-ink"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="login-password" className="text-muted-copy">
          Password
        </Label>
        <Input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          placeholder="••••••••"
          disabled={loading}
          autoComplete="off"
          className="brand-focus bg-field border-line h-9 text-ink"
        />
      </div>
    </>
  )
}

/* ── Login Form Actions ── */

function LoginFormActions({
  loading,
  error,
  onStartLogin,
  onClose,
}: {
  loading: boolean
  error: string | null
  onStartLogin: () => void
  onClose: () => void
}) {
  return (
    <>
      {error && (
        <div className="text-status-danger bg-status-danger-soft border-status-danger-border rounded-md border p-2 text-xs font-medium">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onClose} disabled={loading} size="sm">Cancel</Button>
        <Button onClick={onStartLogin} disabled={loading} size="sm" className="brand-button font-medium">
          {loading ? (
            <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Starting</>
          ) : (
            <><Play className="mr-2 h-3.5 w-3.5" />Start Login</>
          )}
        </Button>
      </div>
    </>
  )
}

function LoginDialogContent({
  username, password, twoFactorSecret, headless, loading, error,
  onUsernameChange, onPasswordChange, onTwoFactorChange, onHeadlessChange, onStartLogin, onClose,
}: {
  username: string; password: string; twoFactorSecret: string; headless: boolean
  loading: boolean; error: string | null
  onUsernameChange: (v: string) => void; onPasswordChange: (v: string) => void
  onTwoFactorChange: (v: string) => void; onHeadlessChange: (v: boolean) => void
  onStartLogin: () => void; onClose: () => void
}) {
  return (
    <div className="grid gap-4 py-2">
      <LoginCredentialFields
        username={username} password={password} loading={loading}
        onUsernameChange={onUsernameChange} onPasswordChange={onPasswordChange}
      />
      <TwoFactorField twoFactorSecret={twoFactorSecret} loading={loading} onChange={onTwoFactorChange} />
      <div className="flex items-center space-x-2 py-2">
        <Checkbox
          id="login-headless" checked={headless}
          onCheckedChange={(checked) => onHeadlessChange(checked === true)}
          disabled={loading} className="brand-checkbox border-line"
        />
        <Label
          htmlFor="login-headless"
          className="text-copy cursor-pointer text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
        >
          Run in background (Headless)
        </Label>
      </div>
      <LoginFormActions loading={loading} error={error} onStartLogin={onStartLogin} onClose={onClose} />
    </div>
  )
}

/* ── 2FA Field ── */

function TwoFactorField({
  twoFactorSecret,
  loading,
  onChange,
}: {
  twoFactorSecret: string
  loading: boolean
  onChange: (v: string) => void
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="login-2fa" className="text-subtle-copy text-xs">
          2FA Secret (TOTP)
        </Label>
        <span className="text-subtle-copy bg-panel-muted border-line-soft rounded-sm border px-1.5 py-0.5 text-[10px]">
          Optional
        </span>
      </div>
      <Input
        id="login-2fa"
        value={twoFactorSecret}
        onChange={(e) => onChange(e.target.value)}
        placeholder="JBSX..."
        disabled={loading}
        autoComplete="off"
        className="brand-focus bg-field border-line h-9 font-mono text-sm text-ink"
      />
    </div>
  )
}

/* ── Login Logs List ── */

function LoginLogsList({
  logs,
  onClose,
}: {
  logs: LogEntry[]
  onClose: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  return (
    <div className="flex flex-col gap-4">
      <div className="border-line bg-shell text-copy relative h-[240px] overflow-hidden rounded-md border p-3">
        <ScrollArea className="h-full">
          <div ref={scrollRef} className="space-y-1 font-mono text-[10px]">
            {logs.length === 0 ? (
              <div className="text-subtle-copy flex animate-pulse items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Initializing...
              </div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="break-all opacity-80">
                  <span
                    className={cn(
                      'mr-2 text-[9px] font-bold uppercase',
                      log.level === 'error'
                        ? 'text-status-danger'
                        : log.level === 'warn'
                          ? 'text-status-warning'
                          : 'text-subtle-copy',
                    )}
                  >
                    {log.level}
                  </span>
                  {log.message}
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="flex justify-end">
        <Button onClick={onClose} size="sm" className="w-full">
          Close & Refresh
        </Button>
      </div>
    </div>
  )
}

/* ── Main LoginDialog ── */

/* ── Login form state ── */

function useLoginFormState() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [twoFactorSecret, setTwoFactorSecret] = useState('')
  const [headless, setHeadless] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<'form' | 'running'>('form')

  return {
    username, setUsername, password, setPassword,
    twoFactorSecret, setTwoFactorSecret, headless, setHeadless,
    loading, setLoading, error, setError, step, setStep,
  }
}

/* ── Main LoginDialog ── */

export function LoginDialog({
  open, profile, logs, onClose, onSuccess,
}: LoginDialogProps) {
  const form = useLoginFormState()

  const handleStartLogin = async () => {
    if (!profile) return
    if (!form.username.trim() || !form.password.trim()) {
      form.setError('Username and password are required'); return
    }
    form.setLoading(true); form.setError(null)
    try {
      await apiFetch('/api/automation/login', {
        method: 'POST',
        body: {
          profileName: profile.name, username: form.username.trim(),
          password: form.password.trim(),
          twoFactorSecret: form.twoFactorSecret.trim() || undefined,
          headless: form.headless,
        },
      })
      form.setStep('running')
    } catch (e) {
      form.setError(e instanceof Error ? e.message : String(e))
    } finally { form.setLoading(false) }
  }

  const handleClose = () => { if (form.step === 'running') onSuccess(); onClose() }
  const filteredLogs = logs.filter((log) => log.source === 'login' || log.source === 'server').slice(-100)

  if (!profile) return null

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="bg-panel border-line text-ink sm:max-w-[425px]">
        <LoginDialogHeader step={form.step} profileName={profile.name} />
        {form.step === 'form' ? (
          <LoginDialogContent
            username={form.username} password={form.password}
            twoFactorSecret={form.twoFactorSecret} headless={form.headless}
            loading={form.loading} error={form.error}
            onUsernameChange={form.setUsername} onPasswordChange={form.setPassword}
            onTwoFactorChange={form.setTwoFactorSecret} onHeadlessChange={form.setHeadless}
            onStartLogin={handleStartLogin} onClose={onClose}
          />
        ) : (
          <LoginLogsList logs={filteredLogs} onClose={handleClose} />
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ── Dialog header ── */

function LoginDialogHeader({ step, profileName }: { step: 'form' | 'running'; profileName: string }) {
  return (
    <DialogHeader>
      <DialogTitle className="page-title-gradient flex items-center gap-2">
        {step === 'form' ? (
          <><Smartphone className="text-muted-copy h-5 w-5" />Login Automation</>
        ) : (
          <><Terminal className="text-muted-copy h-5 w-5" />Running Automation</>
        )}
      </DialogTitle>
      <DialogDescription className="text-subtle-copy text-xs">
        {step === 'form' ? `Enter credentials for ${profileName}.` : `Authenticating ${profileName}...`}
      </DialogDescription>
    </DialogHeader>
  )
}
