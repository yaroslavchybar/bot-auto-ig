import { useState, useEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2, Play, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import type { Profile, LogEntry } from './types'

interface LoginDialogProps {
    open: boolean
    profile: Profile | null
    logs: LogEntry[]
    onClose: () => void
    onSuccess: () => void
}

export function LoginDialog({ open, profile, logs, onClose, onSuccess }: LoginDialogProps) {
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [twoFactorSecret, setTwoFactorSecret] = useState('')
    const [headless, setHeadless] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [step, setStep] = useState<'form' | 'running'>('form')
    const scrollRef = useRef<HTMLDivElement>(null)

    // Auto-scroll logs to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [logs])

    // Reset form when dialog opens
    useEffect(() => {
        if (open) {
            setUsername('')
            setPassword('')
            setTwoFactorSecret('')
            setHeadless(false)
            setError(null)
            setStep('form')
        }
    }, [open])

    const handleStartLogin = async () => {
        if (!profile) return
        if (!username.trim() || !password.trim()) {
            setError('Username and password are required')
            return
        }

        setLoading(true)
        setError(null)

        try {
            await apiFetch('/api/automation/login', {
                method: 'POST',
                body: {
                    profileName: profile.name,
                    username: username.trim(),
                    password: password.trim(),
                    twoFactorSecret: twoFactorSecret.trim() || undefined,
                    headless,
                },
            })
            setStep('running')
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setLoading(false)
        }
    }

    const handleClose = () => {
        if (step === 'running') {
            onSuccess()
        }
        onClose()
    }

    const filteredLogs = logs.filter(
        (log) => log.source === 'login' || log.source === 'server'
    ).slice(-100)

    const getLogColor = (level: string) => {
        switch (level) {
            case 'error':
                return 'text-red-400'
            case 'warn':
                return 'text-yellow-400'
            case 'success':
                return 'text-green-400'
            default:
                return 'text-muted-foreground'
        }
    }

    if (!profile) return null

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        {step === 'form' ? `Login to Instagram: ${profile.name}` : `Login Running: ${profile.name}`}
                    </DialogTitle>
                </DialogHeader>

                {step === 'form' ? (
                    <div className="flex flex-col gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="login-username">Username</Label>
                            <Input
                                id="login-username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="Instagram username"
                                disabled={loading}
                                autoComplete="off"
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="login-password">Password</Label>
                            <Input
                                id="login-password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Instagram password"
                                disabled={loading}
                                autoComplete="off"
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="login-2fa">2FA Secret (Optional)</Label>
                            <Input
                                id="login-2fa"
                                value={twoFactorSecret}
                                onChange={(e) => setTwoFactorSecret(e.target.value)}
                                placeholder="TOTP secret for auto-2FA"
                                disabled={loading}
                                autoComplete="off"
                            />
                        </div>

                        <div className="flex items-center gap-2">
                            <Checkbox
                                id="login-headless"
                                checked={headless}
                                onCheckedChange={(checked) => setHeadless(checked === true)}
                                disabled={loading}
                            />
                            <Label htmlFor="login-headless" className="cursor-pointer">
                                Headless Mode (run browser in background)
                            </Label>
                        </div>

                        {error && (
                            <div className="text-sm text-destructive font-medium">{error}</div>
                        )}

                        <div className="flex justify-end gap-2 pt-2">
                            <Button variant="outline" onClick={onClose} disabled={loading}>
                                Cancel
                            </Button>
                            <Button onClick={handleStartLogin} disabled={loading}>
                                {loading ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Starting...
                                    </>
                                ) : (
                                    <>
                                        <Play className="mr-2 h-4 w-4" />
                                        Start Login
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">
                        <div className="text-sm text-muted-foreground">
                            Login automation is running. Logs will appear below in real-time.
                        </div>

                        <ScrollArea className="h-[300px] rounded-md border bg-muted/20 p-3">
                            <div ref={scrollRef} className="font-mono text-xs space-y-1">
                                {filteredLogs.length === 0 ? (
                                    <div className="text-muted-foreground">Waiting for logs...</div>
                                ) : (
                                    filteredLogs.map((log, i) => (
                                        <div key={i} className={getLogColor(log.level)}>
                                            <span className="opacity-50">[{log.source}]</span> {log.message}
                                        </div>
                                    ))
                                )}
                            </div>
                        </ScrollArea>

                        <div className="flex justify-end">
                            <Button variant="outline" onClick={handleClose}>
                                <X className="mr-2 h-4 w-4" />
                                Close
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
