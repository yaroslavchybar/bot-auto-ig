import { useEffect, useState } from 'react'
import {
  Check,
  CircleAlert,
  Copy,
  Eye,
  EyeOff,
  Pause,
  RefreshCw,
} from 'lucide-react'
import { apiFetch } from '@/lib/api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { StatusBadge, type Account } from './AccountsList'
import { cn } from '@/lib/utils'

type Credential = {
  id: string
  username: string
  password: string
  authenticatorKey: string
  status: Account['status']
  profileId?: string
  error?: string
  createdAt: number
  browserLoggedInAt?: number
}

type WarmupProgress = {
  profileId: string
  modelId: string
  startedAt: number
  targetUsername?: string
  fullName?: string
  nameDone?: boolean
  fullNameDone?: boolean
  avatarDone?: boolean
  postSourceIds: string[]
  postDates: string[]
  outreachReadyMarked?: boolean
  pending?: { kind: string; date: string }
  error?: string
}

type StageState = 'done' | 'current' | 'waiting' | 'attention'

function dateKey(timestamp: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(timestamp)
  const get = (kind: string) =>
    parts.find((part) => part.type === kind)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function dayNumber(startedAt: number, now: number): number {
  const start = Date.parse(`${dateKey(startedAt)}T00:00:00Z`)
  const today = Date.parse(`${dateKey(now)}T00:00:00Z`)
  return Math.floor((today - start) / 86_400_000) + 1
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = value
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}

function SecretRow({ label, value }: { label: string; value: string }) {
  const [visible, setVisible] = useState(false)
  const [copied, setCopied] = useState(false)

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className="text-subtle-copy text-[11px] font-semibold tracking-[0.18em] uppercase">
          {label}
        </div>
        <div className="text-ink mt-0.5 truncate font-mono text-sm">
          {visible ? value : '•'.repeat(Math.min(value.length, 16))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-copy hover:text-ink h-7 w-7"
          title={visible ? 'Hide' : 'Show'}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-copy hover:text-ink h-7 w-7"
          title="Copy"
          onClick={() => {
            void copyText(value).then((ok) => {
              if (ok) {
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1500)
              }
            })
          }}
        >
          {copied ? (
            <Check className="text-status-success h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  )
}

function StageDot({ state }: { state: StageState }) {
  if (state === 'done')
    return <Check className="text-status-success h-4 w-4 shrink-0" />
  if (state === 'attention')
    return <CircleAlert className="text-status-warning h-4 w-4 shrink-0" />
  if (state === 'current')
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        <span className="bg-status-info h-2 w-2 animate-pulse rounded-full" />
      </span>
    )
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
      <Pause className="text-subtle-copy/50 h-3.5 w-3.5" />
    </span>
  )
}

function WarmupStages({
  credential,
  progress,
}: {
  credential: Credential
  progress: WarmupProgress | null
}) {
  if (!credential.profileId) {
    return (
      <p className="text-subtle-copy py-4 text-center text-sm">
        Not assigned to a profile yet — warmup starts after assignment and the
        first browser login.
      </p>
    )
  }
  if (!progress) {
    return (
      <p className="text-subtle-copy py-4 text-center text-sm">
        {credential.browserLoggedInAt
          ? 'Warmup has not started for this profile yet.'
          : 'Warmup starts after the first browser login.'}
      </p>
    )
  }

  const day = dayNumber(progress.startedAt, Date.now())
  const connected = credential.status === 'connected'
  const posts = progress.postSourceIds.length
  const fullNameSkipped =
    !progress.fullNameDone && (progress.avatarDone || posts > 0)

  const stages: Array<{
    label: string
    detail?: string
    state: StageState
  }> = [
    {
      label: 'Browser login',
      detail: credential.browserLoggedInAt
        ? new Date(credential.browserLoggedInAt).toLocaleDateString('en-US', {
            timeZone: 'Europe/Kyiv',
          })
        : undefined,
      state: credential.browserLoggedInAt ? 'done' : 'current',
    },
    {
      label: 'Feed warmup (days 1–2)',
      state:
        day >= 3 ? 'done' : credential.browserLoggedInAt ? 'current' : 'waiting',
    },
    {
      label: 'Mobile login (day 3)',
      state: connected ? 'done' : day >= 3 ? 'current' : 'waiting',
    },
    {
      label: 'Username change',
      detail: progress.targetUsername
        ? `@${progress.targetUsername}`
        : undefined,
      state: progress.nameDone
        ? 'done'
        : connected && !progress.pending
          ? 'current'
          : 'waiting',
    },
    {
      label: 'Full name',
      detail: fullNameSkipped
        ? 'Skipped (no names for this model)'
        : progress.fullName,
      state: progress.fullNameDone || fullNameSkipped ? 'done' : 'waiting',
    },
    {
      label: 'Avatar (day 4+)',
      state: progress.avatarDone ? 'done' : day >= 4 ? 'current' : 'waiting',
    },
    {
      label: 'Feed posts',
      detail: `${Math.min(posts, 9)}/9${progress.postDates.length ? ` · last ${progress.postDates[progress.postDates.length - 1]}` : ''}`,
      state: posts >= 9 ? 'done' : day >= 4 ? 'current' : 'waiting',
    },
    {
      label: 'Outreach ready',
      state: progress.outreachReadyMarked ? 'done' : 'waiting',
    },
  ]

  // First incomplete stage is where the profile is right now.
  const currentIndex = stages.findIndex((stage) => stage.state !== 'done')
  const pendingKind = progress.pending?.kind
  const attentionIndex = pendingKind
    ? {
        name: 3,
        username: 3,
        fullName: 4,
        avatar: 5,
        post: 6,
      }[pendingKind] ?? -1
    : -1

  return (
    <div>
      <p className="text-subtle-copy text-xs">
        Day {day} · started{' '}
        {new Date(progress.startedAt).toLocaleDateString('en-US', {
          timeZone: 'Europe/Kyiv',
        })}
        {currentIndex >= 0 && attentionIndex < 0 && (
          <> · now: {stages[currentIndex].label.toLowerCase()}</>
        )}
      </p>
      {progress.pending && (
        <div
          role="alert"
          className="border-status-warning-border bg-status-warning-soft text-status-warning mt-3 flex items-start gap-2 rounded-xl border px-4 py-2.5 text-sm"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Needs review: {progress.pending.kind} from {progress.pending.date} —
            the result is unknown until the account is checked.
          </span>
        </div>
      )}
      {progress.error && (
        <div
          role="alert"
          className="border-status-danger-border bg-status-danger-soft text-status-danger mt-3 flex items-start gap-2 rounded-xl border px-4 py-2.5 text-sm"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{progress.error}</span>
        </div>
      )}
      <ul className="mt-3 space-y-2">
        {stages.map((stage, index) => {
          const state =
            index === attentionIndex
              ? 'attention'
              : index === currentIndex && stage.state !== 'done'
                ? 'current'
                : stage.state
          return (
            <li key={stage.label} className="flex items-start gap-2.5">
              <span className="mt-0.5">
                <StageDot state={state} />
              </span>
              <div className="min-w-0">
                <span
                  className={cn(
                    'text-sm',
                    state === 'done'
                      ? 'text-subtle-copy'
                      : state === 'waiting'
                        ? 'text-subtle-copy/70'
                        : 'text-ink font-medium',
                  )}
                >
                  {stage.label}
                </span>
                {stage.detail && (
                  <span className="text-subtle-copy ml-2 font-mono text-xs">
                    {stage.detail}
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function AccountDetailsDialog({
  account,
  onClose,
}: {
  account: Account | null
  onClose: () => void
}) {
  const [credential, setCredential] = useState<Credential | null>(null)
  const [progress, setProgress] = useState<WarmupProgress | null | undefined>(
    undefined,
  )
  const [error, setError] = useState('')
  const [warmupError, setWarmupError] = useState('')

  useEffect(() => {
    if (!account) {
      setCredential(null)
      setProgress(undefined)
      setError('')
      setWarmupError('')
      return
    }
    const controller = new AbortController()
    setCredential(null)
    setProgress(undefined)
    setError('')
    setWarmupError('')
    void (async () => {
      try {
        const row = await apiFetch<Credential>(
          `/api/ig-accounts/credentials/${encodeURIComponent(account.id)}`,
          { signal: controller.signal },
        )
        if (controller.signal.aborted) return
        setCredential(row)
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : String(e))
        return
      }
      try {
        const warmup = await apiFetch<WarmupProgress[]>(
          '/api/ig-accounts/warmup',
          { signal: controller.signal },
        )
        if (controller.signal.aborted) return
        setProgress(
          warmup.find((entry) => entry.profileId === account.profileId) ??
            null,
        )
      } catch {
        if (!controller.signal.aborted) {
          setProgress(null)
          setWarmupError('Could not load warmup progress.')
        }
      }
    })()
    return () => controller.abort()
  }, [account])

  return (
    <Dialog
      open={Boolean(account)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="bg-panel border-line text-ink flex max-h-[90vh] flex-col sm:max-w-[560px]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="page-title-gradient flex items-center gap-3">
            <span className="truncate">
              {account?.username ? `@${account.username}` : 'Credential'}
            </span>
            {account && <StatusBadge account={account} />}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <div className="border-status-danger-border bg-status-danger-soft text-status-danger rounded-md border p-3 text-sm font-medium">
              {error}
            </div>
          ) : !credential ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 p-6 text-sm">
              <RefreshCw className="h-4 w-4 animate-spin" /> Loading
              credential...
            </div>
          ) : (
            <div className="grid gap-5">
              <section>
                <h3 className="text-muted-copy text-xs font-semibold tracking-wider uppercase">
                  Credentials
                </h3>
                <div className="border-line-soft divide-line-soft mt-1 divide-y rounded-xl border px-4 py-1">
                  <SecretRow label="Username" value={credential.username} />
                  <SecretRow label="Password" value={credential.password} />
                  <SecretRow label="2FA key" value={credential.authenticatorKey} />
                </div>
              </section>
              <section>
                <h3 className="text-muted-copy text-xs font-semibold tracking-wider uppercase">
                  Warmup progress
                </h3>
                <div className="mt-2">
                  {warmupError && (
                    <p role="status" className="text-status-warning mb-2 text-xs">
                      {warmupError}
                    </p>
                  )}
                  {progress === undefined ? (
                    <div className="text-muted-foreground flex items-center justify-center gap-2 p-4 text-sm">
                      <RefreshCw className="h-4 w-4 animate-spin" /> Loading
                      progress...
                    </div>
                  ) : (
                    <WarmupStages credential={credential} progress={progress} />
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
