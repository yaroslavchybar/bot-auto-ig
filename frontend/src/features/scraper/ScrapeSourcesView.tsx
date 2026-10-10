import { useState } from 'react'
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { toast } from 'sonner'
import { ArrowLeft, Pause, Play, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { api } from '../../../../convex/_generated/api'
import type { Doc, Id } from '../../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog'
import { Navigate, useLocation, useNavigate } from '@/lib/router'
import { cn } from '@/lib/utils'
import { useLeadListSummary } from './useLeadListSummary'

const stamp = (at?: number) => (at ? new Date(at).toLocaleString() : 'Not checked yet')

function SourceStatusBadge({
  source,
}: {
  source: { enabled: boolean; running?: boolean; error?: string | null }
}) {
  const state = !source.enabled
    ? {
        label: 'Paused',
        className: 'bg-panel-muted text-copy border-line',
        dot: 'bg-subtle-copy',
      }
    : source.running
      ? {
          label: 'Checking',
          className: 'bg-status-info-soft text-status-info border-status-info-border',
          dot: 'bg-status-info',
        }
      : source.error
        ? {
            label: 'Retrying',
            className: 'bg-status-warning-soft text-status-warning border-status-warning-border',
            dot: 'bg-status-warning',
          }
        : {
            label: 'Active',
            className: 'bg-status-success-soft text-status-success border-status-success-border',
            dot: 'status-dot-success-tight',
          }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        state.className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', state.dot)} />
      {state.label}
    </span>
  )
}

export function ScrapeSourcesView() {
  const { search } = useLocation()
  const navigate = useNavigate()
  const requested = new URLSearchParams(search).get('listId')
  const list = useQuery(api.leads.getList, requested ? { listId: requested } : 'skip')
  if (!requested) return <Navigate to="/scraper?tab=sources" replace />
  if (list === undefined) {
    return <div className="p-12 text-center text-sm text-muted-foreground">Loading...</div>
  }
  if (!list) return <Navigate to="/scraper?tab=sources" replace />
  return <ListDetail key={list._id} list={list} onBack={() => navigate('/scraper?tab=sources')} />
}

function ListDetail({ list, onBack }: { list: Doc<'leadLists'>; onBack: () => void }) {
  const sources = useQuery(api.scrapeSources.sources, { listId: list._id })
  const counts = useLeadListSummary(list._id)
  const settings = useMutation(api.scrapeSources.settings)
  const [addOpen, setAddOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [baseline, setBaseline] = useState({
    days: list.scrapeLookbackDays ?? 90,
    monitor: list.scrapeMonitor ?? true,
  })
  const [daysText, setDaysText] = useState(String(list.scrapeLookbackDays ?? 90))
  const [monitor, setMonitor] = useState(list.scrapeMonitor ?? true)
  const serverDays = list.scrapeLookbackDays ?? 90
  const serverMonitor = list.scrapeMonitor ?? true
  if (baseline.days !== serverDays || baseline.monitor !== serverMonitor) {
    setBaseline({ days: serverDays, monitor: serverMonitor })
    setDaysText(String(serverDays))
    setMonitor(serverMonitor)
  }
  const leads = counts?.leads
  const days = Number(daysText)
  const valid = Number.isSafeInteger(days) && days >= 1 && days <= 3650
  const changed = valid && (days !== baseline.days || monitor !== baseline.monitor)
  const saveSettings = async () => {
    if (busy || !valid || !changed) return
    setBusy(true)
    try {
      await settings({ listId: list._id, days, monitor })
      toast.success('Scanning settings saved')
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-4 pt-2 md:pt-3">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <Button variant="ghost" onClick={onBack} className="-ml-2 text-muted-copy hover:text-ink">
          <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Lists
        </Button>
        <h2 className="text-lg font-semibold tracking-tight text-ink">{list.name}</h2>
        {sources !== undefined && (
          <p className="text-xs text-muted-copy tabular-nums">
            {sources.length} {sources.length === 1 ? 'source' : 'sources'} ·{' '}
            {leads?.toLocaleString() ?? '…'} {leads === 1 ? 'lead' : 'leads'}
          </p>
        )}
        <div
          aria-label="Scanning settings"
          className="flex items-center gap-x-2.5 rounded-full border border-line-soft bg-panel-subtle py-1 pr-1.5 pl-3 text-[13px]"
        >
          <div className="flex items-center gap-1.5">
            <Label htmlFor="source-days" className="text-muted-copy">
              Last
            </Label>
            <Input
              id="source-days"
              type="number"
              min={1}
              max={3650}
              value={daysText}
              disabled={busy}
              onChange={(e) => setDaysText(e.target.value)}
              className="h-6 w-14 rounded-full bg-field text-center tabular-nums"
            />
            <span className="text-muted-copy">days</span>
          </div>
          <span className="h-4 w-px bg-line" aria-hidden />
          <div className="flex items-center gap-1.5">
            <span className="whitespace-nowrap text-copy">Watch hot posts</span>
            <Switch
              checked={monitor}
              onCheckedChange={setMonitor}
              disabled={busy}
              aria-label="Watch hot posts"
            />
          </div>
          {changed && (
            <Button disabled={busy} onClick={() => void saveSettings()}>
              Save
            </Button>
          )}
        </div>
        <Button className="ml-auto brand-button" onClick={() => setAddOpen(true)}>
          <Plus className="mr-2 h-3.5 w-3.5" /> Add profiles
        </Button>
      </div>
      <SourceCards sources={sources} list={list} onAdd={() => setAddOpen(true)} />
      {addOpen && <AddProfilesDialog list={list} onClose={() => setAddOpen(false)} />}
    </div>
  )
}

function AddProfilesDialog({ list, onClose }: { list: Doc<'leadLists'>; onClose: () => void }) {
  const add = useMutation(api.scrapeSources.add)
  const [links, setLinks] = useState('')
  const [busy, setBusy] = useState(false)
  const parsedLinks = links
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const submit = async () => {
    if (busy || parsedLinks.length === 0 || parsedLinks.length > 50) return
    setBusy(true)
    try {
      const result = await add({ listId: list._id, links: parsedLinks })
      toast.success(
        `${result.created} sources added${result.duplicates ? `, ${result.duplicates} already in this list` : ''}`,
      )
      onClose()
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col border-line bg-panel text-ink sm:max-w-[560px]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="page-title-gradient">Add profiles to {list.name}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2 py-1">
          <Label htmlFor="source-links">Instagram profile URLs or usernames</Label>
          <Textarea
            id="source-links"
            value={links}
            onChange={(e) => setLinks(e.target.value)}
            placeholder={'https://www.instagram.com/example/\n@another_profile'}
            rows={5}
            className="brand-focus border-line bg-field"
            autoFocus
          />
          <p className="text-xs text-subtle-copy" aria-live="polite">
            {parsedLinks.length > 50
              ? 'Add up to 50 at a time'
              : parsedLinks.length > 0
                ? `${parsedLinks.length} ${parsedLinks.length === 1 ? 'profile' : 'profiles'} detected`
                : 'Links or usernames, one per line'}
          </p>
        </div>
        <DialogFooter className="shrink-0 gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy} className="button-ghost">
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || parsedLinks.length === 0 || parsedLinks.length > 50}
            className="brand-button"
          >
            {busy
              ? 'Adding...'
              : parsedLinks.length > 0
                ? `Add ${parsedLinks.length}`
                : 'Add profiles'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SourceCards({
  list,
  sources,
  onAdd,
}: {
  list: Doc<'leadLists'>
  sources: FunctionReturnType<typeof api.scrapeSources.sources> | undefined
  onAdd: () => void
}) {
  const toggle = useMutation(api.scrapeSources.setEnabled)
  const check = useMutation(api.scrapeSources.checkNow)
  const remove = useMutation(api.scrapeSources.remove)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<Id<'scrapeSources'> | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    _id: Id<'scrapeSources'>
    username: string
  } | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {sources === undefined ? (
        <div className="p-12 text-center text-sm text-muted-foreground">Loading sources...</div>
      ) : !sources.length ? (
        <div className="rounded-2xl border-2 border-dashed border-line-soft bg-panel-subtle p-12 text-center">
          <p className="text-sm font-medium text-ink">No sources yet</p>
          <p className="mt-1 text-sm text-subtle-copy">
            Add profiles — their likers will be saved to {list.name}.
          </p>
          <Button className="mt-4 brand-button" onClick={onAdd}>
            <Plus className="mr-2 h-3.5 w-3.5" /> Add profiles
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {sources.map((source) => (
            <div
              key={source._id}
              className="rounded-2xl border border-line-soft bg-panel-subtle p-4 shadow-xs"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      className="font-semibold brand-link"
                      href={`https://www.instagram.com/${source.username}/`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      @{source.username}
                    </a>
                    <SourceStatusBadge source={source} />
                  </div>
                  <p className="mt-1.5 text-xs text-muted-copy tabular-nums">
                    {source.postCount} posts · {source.discovered.toLocaleString()} leads · avg{' '}
                    {source.averageLikes === undefined ? '—' : Math.round(source.averageLikes)}{' '}
                    likes
                  </p>
                  <p className="mt-0.5 text-xs text-subtle-copy">
                    Last scan: {stamp(source.lastCheckAt)}
                    {source.enabled ? ` · Next scan: ${stamp(source.nextCheckAt)}` : ''}
                  </p>
                  {source.error && (
                    <p className="mt-1 text-xs text-status-danger">{source.error}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    variant="outline"
                    onClick={() => setExpanded(expanded === source._id ? null : source._id)}
                  >
                    {expanded === source._id ? 'Hide posts' : 'View posts'}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy || !source.enabled || source.running}
                    onClick={() => void run(() => check({ sourceId: source._id }))}
                  >
                    <RotateCcw className="mr-1 h-3.5 w-3.5" />
                    Check now
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(() => toggle({ sourceId: source._id, enabled: !source.enabled }))
                    }
                  >
                    {source.enabled ? (
                      <Pause className="mr-1 h-3.5 w-3.5" />
                    ) : (
                      <Play className="mr-1 h-3.5 w-3.5" />
                    )}
                    {source.enabled ? 'Pause' : 'Resume'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${source.username}`}
                    disabled={busy}
                    onClick={() => setDeleteTarget(source)}
                  >
                    <Trash2 className="h-4 w-4 text-status-danger" />
                  </Button>
                </div>
              </div>
              {expanded === source._id && <SourcePosts sourceId={source._id} />}
            </div>
          ))}
        </div>
      )}
      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onCancel={() => {
          if (!deleteBusy) setDeleteTarget(null)
        }}
        title="Remove source"
        entityLabel="source"
        itemName={`@${deleteTarget?.username ?? ''}`}
        confirmLabel="Remove"
        extraDescription="Collected leads stay in the list."
        saving={deleteBusy}
        onConfirm={async () => {
          if (!deleteTarget) return
          setDeleteBusy(true)
          try {
            await remove({ sourceId: deleteTarget._id })
            setDeleteTarget(null)
          } catch (e) {
            toast.error(String(e))
          } finally {
            setDeleteBusy(false)
          }
        }}
      />
    </>
  )
}

function SourcePosts({ sourceId }: { sourceId: Id<'scrapeSources'> }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.scrapeSources.posts,
    { sourceId },
    { initialNumItems: 50 },
  )
  return (
    <div className="mt-4 divide-y divide-line-soft border-t border-line-soft pt-1">
      {status === 'LoadingFirstPage' ? (
        <p className="py-3 text-sm text-muted-copy">Loading posts...</p>
      ) : !results.length ? (
        <p className="py-3 text-sm text-muted-copy">No posts found yet.</p>
      ) : (
        results.map((post) => {
          const monitoring = post.monitoring && post.scheduled
          return (
            <div key={post._id} className="flex flex-wrap justify-between gap-2 py-2 text-xs">
              <a
                className="brand-link"
                href={`https://www.instagram.com/p/${post.code}/`}
                target="_blank"
                rel="noreferrer"
              >
                {new Date(post.takenAt).toLocaleDateString()} · {post.likeCount ?? 'Unknown'} likes
              </a>
              <span className="text-muted-copy">
                {post.error
                  ? post.error
                  : monitoring
                    ? `Monitoring · Next: ${stamp(post.nextCheckAt)}`
                    : post.monitorStoppedAt
                      ? 'Stopped: low traffic'
                      : post.lastScrapedAt
                        ? `Scraped ${stamp(post.lastScrapedAt)}`
                        : 'Waiting for first scrape'}
                {post.averageNewIds !== undefined &&
                  ` · ${post.averageNewIds.toFixed(1)} new IDs/check (${post.checkCount}/10)`}
                {post.likesPerHour !== undefined && ` · ${post.likesPerHour.toFixed(1)} likes/hour`}
              </span>
            </div>
          )
        })
      )}
      {status !== 'Exhausted' && (
        <Button variant="outline" disabled={status !== 'CanLoadMore'} onClick={() => loadMore(50)}>
          Load more posts
        </Button>
      )}
    </div>
  )
}
