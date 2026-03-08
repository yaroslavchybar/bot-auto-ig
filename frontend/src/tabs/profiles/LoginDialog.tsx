import { useState, useEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2, Play, Terminal, Smartphone } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import type { Profile, LogEntry } from './types'
import { cn } from '@/lib/utils'

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
    const [headless, setHeadless] = useState(true)
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
            setHeadless(true)
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

    if (!profile) return null

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
            <DialogContent className="sm:max-w-[425px] bg-[#0a0a0a] border-white/10 text-gray-200">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                        {step === 'form' ? (
                            <>
                                <Smartphone className="h-5 w-5 text-gray-400" />
                                Login Automation
                            </>
                        ) : (
                            <>
                                <Terminal className="h-5 w-5 text-gray-400" />
                                Running Automation
                            </>
                        )}
                    </DialogTitle>
                    <DialogDescription className="text-xs text-gray-500">
                        {step === 'form'
                            ? `Enter credentials for ${profile.name}.`
                            : `Authenticating ${profile.name}...`
                        }
                    </DialogDescription>
                </DialogHeader>

                {step === 'form' ? (
                    <div className="grid gap-4 py-2">
                        <div className="grid gap-2">
                            <Label htmlFor="login-username" className="text-gray-400">Instagram Username</Label>
                            <Input
                                id="login-username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="username"
                                disabled={loading}
                                autoComplete="off"
                                className="h-9 bg-black/50 border-white/10 text-white focus-visible:ring-red-500/50 focus-visible:border-red-500"
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="login-password" className="text-gray-400">Password</Label>
                            <Input
                                id="login-password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                disabled={loading}
                                autoComplete="off"
                                className="h-9 bg-black/50 border-white/10 text-white focus-visible:ring-red-500/50 focus-visible:border-red-500"
                            />
                        </div>

                        <div className="grid gap-2">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="login-2fa" className="text-xs text-gray-500">2FA Secret (TOTP)</Label>
                                <span className="text-[10px] text-gray-500 bg-white/5 py-0.5 px-1.5 rounded-sm border border-white/5">Optional</span>
                            </div>
                            <Input
                                id="login-2fa"
                                value={twoFactorSecret}
                                onChange={(e) => setTwoFactorSecret(e.target.value)}
                                placeholder="JBSX..."
                                disabled={loading}
                                autoComplete="off"
                                className="h-9 font-mono text-sm bg-black/50 border-white/10 text-white focus-visible:ring-red-500/50 focus-visible:border-red-500"
                            />
                        </div>

                        <div className="flex items-center space-x-2 py-2">
                            <Checkbox
                                id="login-headless"
                                checked={headless}
                                onCheckedChange={(checked) => setHeadless(checked === true)}
                                disabled={loading}
                                className="border-white/10 data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500 text-white"
                            />
                            <Label htmlFor="login-headless" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer text-gray-300">
                                Run in background (Headless)
                            </Label>
                        </div>

                        {error && (
                            <div className="text-xs text-red-400 font-medium bg-red-500/10 p-2 rounded-md border border-red-500/20">{error}</div>
                        )}

                        <div className="flex justify-end gap-2 pt-2">
                            <Button variant="ghost" onClick={onClose} disabled={loading} size="sm" className="bg-transparent border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition-all shadow-none">
                                Cancel
                            </Button>
                            <Button onClick={handleStartLogin} disabled={loading} size="sm" className="border-none bg-gradient-to-r from-red-600 to-orange-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)] hover:shadow-[0_0_25px_rgba(239,68,68,0.6)] hover:from-red-500 hover:to-orange-400 transition-all font-medium">
                                {loading ? (
                                    <>
                                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                        Starting
                                    </>
                                ) : (
                                    <>
                                        <Play className="mr-2 h-3.5 w-3.5" />
                                        Start Login
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">
                        <div className="rounded-md border border-white/10 bg-[#050505] text-gray-300 p-3 h-[240px] relative overflow-hidden">
                            <ScrollArea className="h-full">
                                <div ref={scrollRef} className="font-mono text-[10px] space-y-1">
                                    {filteredLogs.length === 0 ? (
                                        <div className="text-gray-500 animate-pulse flex items-center gap-2">
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                            Initializing...
                                        </div>
                                    ) : (
                                        filteredLogs.map((log, i) => (
                                            <div key={i} className="break-all opacity-80">
                                                <span className={cn(
                                                    "uppercase text-[9px] mr-2 font-bold",
                                                    log.level === 'error' ? "text-red-400" :
                                                        log.level === 'warn' ? "text-orange-400" :
                                                            "text-gray-500"
                                                )}>{log.level}</span>
                                                {log.message}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </ScrollArea>
                        </div>

                        <div className="flex justify-end">
                            <Button onClick={handleClose} size="sm" className="w-full bg-transparent border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition-all shadow-none">
                                Close & Refresh
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
