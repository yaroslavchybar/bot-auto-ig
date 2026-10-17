import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useHeaderToolbarSlot } from '@/components/layout/useHeaderSlot'
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { toast } from 'sonner'
import { ArrowLeft, Pause, Play, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { api } from '../../../../convex/_generated/api'
import type { Doc, Id } from '../../../../convex/_generated/dataModel'
import { DEFAULT_SCRAPE_POST_LIMIT } from '../../../../convex/scrapeMonitoring'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  source: { enabled: boolean; running?: boolean; runKind?: 'posts' | 'likers'; error?: string | null }
}) {
  const state = !source.enabled
    ? {
        label: 'Paused',
        className: 'bg-panel-muted text-copy border-line',
        dot: 'bg-subtle-copy',
      }
    : source.running
      ? {
          label:
            source.runKind === 'posts'
              ? 'Finding posts'
              : source.runKind === 'likers'
                ? 'Checking likers'
                : 'Checking',
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
  const headerSlot = useHeaderToolbarSlot('scraper-header-slot', 360)
  const sources = useQuery(api.scrapeSources.sources, { listId: list._id })
  const counts = useLeadListSummary(list._id)
  const settings = useMutation(api.scrapeSources.settings)
  const [addOpen, setAddOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [baseline, setBaseline] = useState({
    days: list.scrapeLookbackDays ?? 90,
    monitor: list.scrapeMonitor ?? true,
    postLimit: list.scrapePostLimit ?? DEFAULT_SCRAPE_POST_LIMIT,
  })
  const [daysText, setDaysText] = useState(String(list.scrapeLookbackDays ?? 90))
  const [monitor, setMonitor] = useState(list.scrapeMonitor ?? true)
  const [postLimitText, setPostLimitText] = useState(
    String(list.scrapePostLimit ?? DEFAULT_SCRAPE_POST_LIMIT),
  )
  const serverDays = list.scrapeLookbackDays ?? 90
  const serverMonitor = list.scrapeMonitor ?? true
  const serverPostLimit = list.scrapePostLimit ?? DEFAULT_SCRAPE_POST_LIMIT
  if (
    baseline.days !== serverDays ||
    baseline.monitor !== serverMonitor ||
    baseline.postLimit !== serverPostLimit
  ) {
    setBaseline({
      days: serverDays,
      monitor: serverMonitor,
      postLimit: serverPostLimit,
    })
    setDaysText(String(serverDays))
    setMonitor(serverMonitor)
    setPostLimitText(String(serverPostLimit))
  }
  const leads = counts?.leads
  const days = Number(daysText)
  const postLimit = Number(postLimitText)
  const valid =
    Number.isSafeInteger(days) &&
    days >= 1 &&
    days <= 3650 &&
    Number.isSafeInteger(postLimit) &&
    postLimit >= 1 &&
    postLimit <= 5000
  const changed =
    valid &&
    (days !== baseline.days || monitor !== baseline.monitor || postLimit !== baseline.postLimit)
  const saveSettings = async () => {
    if (busy || !valid || !changed) return
    setBusy(true)
    try {
      await settings({ listId: list._id, days, monitor, postLimit })
      toast.success('Scanning settings saved')
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusy(false)
    }
  }
  const listSummary = (
    <div className="flex min-w-0 items-center gap-2.5">
      <h2 className="truncate text-lg font-semibold tracking-tight text-ink" title={list.name}>
        {list.name}
      </h2>
      {sources !== undefined && (
        <p className="shrink-0 text-xs whitespace-nowrap text-muted-copy tabular-nums">
          {sources.length} {sources.length === 1 ? 'source' : 'sources'} ·{' '}
          {leads?.toLocaleString() ?? '…'} {leads === 1 ? 'lead' : 'leads'}
        </p>
      )}
    </div>
  )
  return (
    <div className="space-y-4 pt-2 md:pt-3">
      {headerSlot &&
        createPortal(
          <div className="flex min-w-0 flex-1 items-center">{listSummary}</div>,
          headerSlot,
        )}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <Button variant="ghost" onClick={onBack} className="-ml-2 text-muted-copy hover:text-ink">
          <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Lists
        </Button>
        {!headerSlot && listSummary}
        <div
          aria-label="Scanning settings"
          className="flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-2xl border border-line-soft bg-panel-subtle py-1 pr-1.5 pl-3 text-[13px]"
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
            <Label htmlFor="source-post-limit" className="text-muted-copy">
              Latest
            </Label>
            <Input
              id="source-post-limit"
              type="number"
              min={1}
              max={5000}
              value={postLimitText}
              disabled={busy}
              onChange={(e) => setPostLimitText(e.target.value)}
              className="h-6 w-14 rounded-full bg-field text-center tabular-nums"
            />
            <span className="text-muted-copy">posts</span>
          </div>
          <span className="h-4 w-px bg-line" aria-hidden />
          <div className="flex items-center gap-1.5">
            <span className="whitespace-nowrap text-copy">Monitor posts</span>
            <Switch
              checked={monitor}
              onCheckedChange={setMonitor}
              disabled={busy}
              aria-label="Monitor posts"
            />
          </div>
          <span className="h-4 w-px bg-line" aria-hidden />
          <div className="flex items-center gap-1.5">
            <Label htmlFor="source-monitor-days" className="whitespace-nowrap text-copy">
              Monitor for
            </Label>
            <Input
              id="source-monitor-days"
              type="number"
              min={1}
              max={3650}
              value="1"
              disabled
              className="h-6 w-14 rounded-full bg-field text-center tabular-nums"
            />
            <span className="text-muted-copy">day · every 1–3 hours</span>
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
  const [selectedId, setSelectedId] = useState<Id<'scrapeSources'> | null>(null)
  const selected = sources?.find((source) => source._id === selectedId)
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
                    {source.postCount} posts · {source.leadsAdded.toLocaleString()} leads · avg{' '}
                    {source.averageLikes === undefined ? '—' : Math.round(source.averageLikes)}{' '}
                    likes
                  </p>
                  <p className="mt-0.5 text-xs text-subtle-copy">
                    Last post discovery: {stamp(source.lastPostsCheckAt)}
                    {source.enabled ? ` · Next discovery: ${stamp(source.nextCheckAt)}` : ''}
                  </p>
                  <p className="mt-0.5 text-xs text-subtle-copy">
                    Last liker check: {stamp(source.lastLikerCheckAt)}
                  </p>
                  {source.error && (
                    <p className="mt-1 text-xs text-status-danger">{source.error}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Button variant="outline" onClick={() => setSelectedId(source._id)}>
                    View posts
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
            </div>
          ))}
        </div>
      )}
      {selected && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setSelectedId(null)
          }}
        >
          <DialogContent className="flex max-h-[85vh] w-[calc(100%_-_2rem)] flex-col sm:max-w-4xl">
            <DialogHeader className="shrink-0 pr-5">
              <DialogTitle>Posts from @{selected.username}</DialogTitle>
              <DialogDescription>
                Liker checks update live.{' '}
                {list.scrapeMonitor === false
                  ? 'Monitoring is disabled for this list.'
                  : `Monitoring lasts 24 hours from the first scrape, with checks every 1–3 hours.`}
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 overflow-y-auto">
              <SourcePosts
                sourceId={selected._id}
                enabled={selected.enabled}
                monitor={list.scrapeMonitor !== false}
                running={selected.enabled && selected.running}
                currentPostId={selected.currentPostId}
              />
            </div>
          </DialogContent>
        </Dialog>
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

function SourcePosts({
  sourceId,
  enabled,
  monitor,
  running,
  currentPostId,
}: {
  sourceId: Id<'scrapeSources'>
  enabled: boolean
  monitor: boolean
  running: boolean
  currentPostId?: Id<'scrapePosts'>
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.scrapeSources.posts,
    { sourceId },
    { initialNumItems: 50 },
  )
  return (
    <div className="divide-y divide-line-soft">
      {status === 'LoadingFirstPage' ? (
        <p className="py-3 text-sm text-muted-copy">Loading posts...</p>
      ) : !results.length ? (
        <p className="py-3 text-sm text-muted-copy">No posts found yet.</p>
      ) : (
        results.map((post) => {
          const monitoring = enabled && monitor && post.monitoring && post.scheduled
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
                {!enabled
                  ? 'Paused'
                  : running && currentPostId === post._id
                    ? 'Checking likers now'
                    : post.error
                      ? post.error
                      : monitoring
                        ? `Monitoring · Next: ${stamp(post.nextCheckAt)} · Ends: ${stamp(post.monitorEndsAt)}`
                        : post.monitorStoppedAt
                          ? 'Monitoring completed'
                          : post.lastScrapedAt
                            ? `Scraped ${stamp(post.lastScrapedAt)}`
                            : 'Waiting for first scrape'}
                {post.lastScrapedAt && monitoring && ` · Last check: ${stamp(post.lastScrapedAt)}`}
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
