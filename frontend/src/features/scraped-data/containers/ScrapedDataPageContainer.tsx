import { useCallback, useMemo, useState } from 'react'
import { useConvex, useMutation, useQuery } from 'convex/react'
import { useNavigate } from 'react-router'
import { RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog'
import { apiDownload } from '@/lib/api'
import { AmbientGlow } from '@/components/ui/ambient-glow'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ScrapedDataList } from '../components/ScrapedDataList'
import { ScrapedDataDetails } from '../components/ScrapedDataDetails'
import type { WorkflowArtifact } from '../types'
import { getArtifactSortTimestamp } from '../utils'

/* ── State + handler hook ── */

function useScrapedDataState() {
  const convex = useConvex()
  const navigate = useNavigate()
  const removeArtifact = useMutation(api.workflowArtifacts.remove)
  const artifactsQuery = useQuery(api.workflowArtifacts.listAll, {})
  const artifacts = useMemo(
    () => (Array.isArray(artifactsQuery) ? (artifactsQuery as WorkflowArtifact[]) : []),
    [artifactsQuery],
  )

  const [searchQuery, setSearchQuery] = useState('')
  const [detailsArtifactId, setDetailsArtifactId] = useState<
    Id<'workflowArtifacts'> | null
  >(null)
  const [deletingArtifactId, setDeletingArtifactId] = useState<
    Id<'workflowArtifacts'> | null
  >(null)
  const [savingDelete, setSavingDelete] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [hiddenArtifactIds, setHiddenArtifactIds] = useState<Id<'workflowArtifacts'>[]>([])

  const isLoading = artifactsQuery === undefined
  const visibleArtifacts = useMemo(
    () => artifacts.filter((artifact) => !hiddenArtifactIds.includes(artifact._id)),
    [artifacts, hiddenArtifactIds],
  )

  const filteredArtifacts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return [...visibleArtifacts]
      .sort((a, b) => getArtifactSortTimestamp(b) - getArtifactSortTimestamp(a))
      .filter((artifact) => {
        if (!query) return true
        const haystack = [
          artifact.name, artifact.workflowName, artifact.nodeLabel,
          artifact.sourceProfileName, artifact.targetUsername, artifact.kind,
        ].map((value) => String(value || '').toLowerCase()).join(' ')
        return haystack.includes(query)
      })
  }, [visibleArtifacts, searchQuery])

  const detailsArtifact =
    visibleArtifacts.find((artifact) => artifact._id === detailsArtifactId) ?? null
  const deletingArtifact =
    visibleArtifacts.find((artifact) => artifact._id === deletingArtifactId) ?? null

  return {
    convex, navigate, removeArtifact,
    searchQuery, setSearchQuery,
    detailsArtifactId, setDetailsArtifactId,
    deletingArtifactId, setDeletingArtifactId,
    savingDelete, setSavingDelete,
    refreshing, setRefreshing,
    pageError, setPageError,
    hiddenArtifactIds, setHiddenArtifactIds,
    isLoading, visibleArtifacts, filteredArtifacts,
    detailsArtifact, deletingArtifact,
  }
}

/* ── Download handlers ── */

function useArtifactDownload(setPageError: (e: string | null) => void) {
  const downloadArtifact = useCallback(
    async (storageId: Id<'_storage'> | null | undefined, fileName: string) => {
      if (!storageId) throw new Error('Artifact file is not available')
      await apiDownload(
        `/api/workflows/artifacts/download?storageId=${encodeURIComponent(storageId)}&fileName=${encodeURIComponent(fileName)}`,
        fileName,
      )
    },
    [],
  )

  const handleDownloadData = useCallback(
    async (artifact: WorkflowArtifact) => {
      setPageError(null)
      try {
        await downloadArtifact(
          artifact.exportStorageId || artifact.storageId,
          `${artifact.name || artifact.nodeLabel || 'scrape-result'}.json`,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setPageError(message); toast.error(message)
      }
    },
    [downloadArtifact, setPageError],
  )

  const handleDownloadManifest = useCallback(
    async (artifact: WorkflowArtifact) => {
      setPageError(null)
      try {
        await downloadArtifact(
          artifact.manifestStorageId,
          `${artifact.name || artifact.nodeLabel || 'scrape-result'}_manifest.json`,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setPageError(message); toast.error(message)
      }
    },
    [downloadArtifact, setPageError],
  )

  return { handleDownloadData, handleDownloadManifest }
}

/* ── CRUD handlers ── */

function useArtifactDelete(state: ReturnType<typeof useScrapedDataState>) {
  const { removeArtifact, setPageError, setSavingDelete,
    setDetailsArtifactId, setDeletingArtifactId,
    setHiddenArtifactIds, deletingArtifactId, detailsArtifactId } = state

  const handleDeleteClick = useCallback((artifact: WorkflowArtifact) => {
    setDeletingArtifactId(artifact._id); setPageError(null)
  }, [setDeletingArtifactId, setPageError])

  const handleConfirmDelete = useCallback(async () => {
    if (!deletingArtifactId) return
    setSavingDelete(true); setPageError(null)
    try {
      const removed = await removeArtifact({ id: deletingArtifactId })
      setHiddenArtifactIds((current) =>
        current.includes(deletingArtifactId) ? current : [...current, deletingArtifactId],
      )
      toast.success(`Deleted "${removed.name}"`)
      if (detailsArtifactId === deletingArtifactId) setDetailsArtifactId(null)
      setDeletingArtifactId(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setPageError(message); toast.error(message)
    } finally { setSavingDelete(false) }
  }, [deletingArtifactId, detailsArtifactId, removeArtifact, setDeletingArtifactId,
    setDetailsArtifactId, setHiddenArtifactIds, setPageError, setSavingDelete])

  return { handleDeleteClick, handleConfirmDelete }
}

function useScrapedDataHandlers(state: ReturnType<typeof useScrapedDataState>) {
  const { convex, navigate, setPageError, setRefreshing,
    setDetailsArtifactId, setHiddenArtifactIds } = state

  const downloads = useArtifactDownload(setPageError)
  const deleteHandlers = useArtifactDelete(state)

  const handleViewDetails = useCallback((artifact: WorkflowArtifact) => {
    setDetailsArtifactId(artifact._id); setPageError(null)
  }, [setDetailsArtifactId, setPageError])

  const handleOpenWorkflow = useCallback(
    (artifact: WorkflowArtifact) => { navigate(`/workflows/${artifact.workflowId}/editor`) },
    [navigate],
  )

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([
        convex.query(api.workflowArtifacts.listAll, {}),
        new Promise((resolve) => setTimeout(resolve, 300)),
      ])
      setHiddenArtifactIds([])
    } finally { setRefreshing(false) }
  }, [convex, setHiddenArtifactIds, setRefreshing])

  return {
    ...downloads, ...deleteHandlers, handleViewDetails,
    handleOpenWorkflow, handleRefresh,
  }
}

/* ── Search header ── */

function ScrapedDataHeader({
  searchQuery,
  onSearchChange,
  onRefresh,
  isLoading,
  refreshing,
}: {
  searchQuery: string
  onSearchChange: (v: string) => void
  onRefresh: () => void
  isLoading: boolean
  refreshing: boolean
}) {
  return (
    <div className="relative z-10 flex-none px-4 pt-2 pb-2 md:px-6 md:pt-3 md:pb-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
        <div className="flex flex-grow items-center gap-2">
          <div className="relative flex-1 sm:w-[280px] sm:flex-initial">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-copy" />
            <Input
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search..."
              className="bg-field border border-line text-copy placeholder:text-muted-copy brand-focus h-8 rounded-md pl-9 text-sm font-normal leading-5 shadow-sm"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={onRefresh}
            disabled={isLoading || refreshing}
            aria-label="Refresh artifacts"
            title="Refresh artifacts"
            className="h-8 w-8 shrink-0 p-0"
          >
            <RefreshCw
              className={isLoading || refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
            />
            <span className="sr-only">Refresh</span>
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ── Details sheet ── */

function ScrapedDataDetailsSheet({
  detailsArtifact,
  onClose,
  onDownloadData,
  onDownloadManifest,
  onDelete,
  onOpenWorkflow,
}: {
  detailsArtifact: WorkflowArtifact | null
  onClose: () => void
  onDownloadData: (a: WorkflowArtifact) => void
  onDownloadManifest: (a: WorkflowArtifact) => void
  onDelete: (a: WorkflowArtifact) => void
  onOpenWorkflow: (a: WorkflowArtifact) => void
}) {
  return (
    <Sheet open={Boolean(detailsArtifact)} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent className="border-line bg-panel text-ink flex w-full max-w-full flex-col gap-0 border-l p-0 shadow-xl sm:w-[540px]">
        <SheetHeader className="border-line-soft bg-panel-subtle border-b p-6 pb-4">
          <SheetTitle className="page-title-gradient">Artifact Details</SheetTitle>
        </SheetHeader>
        {detailsArtifact ? (
          <ScrapedDataDetails
            artifact={detailsArtifact}
            onDownloadData={(a) => void onDownloadData(a)}
            onDownloadManifest={(a) => void onDownloadManifest(a)}
            onDelete={onDelete}
            onOpenWorkflow={onOpenWorkflow}
          />
        ) : (
          <div className="text-muted-foreground p-8 text-center text-sm">Artifact unavailable.</div>
        )}
      </SheetContent>
    </Sheet>
  )
}

/* ── Main component ── */

export function ScrapedDataPageContainer() {
  const state = useScrapedDataState()
  const handlers = useScrapedDataHandlers(state)

  return (
    <div className="bg-shell text-ink animate-in fade-in relative flex h-full flex-col duration-300">
      <AmbientGlow />

      <ScrapedDataHeader
        searchQuery={state.searchQuery}
        onSearchChange={state.setSearchQuery}
        onRefresh={() => void handlers.handleRefresh()}
        isLoading={state.isLoading}
        refreshing={state.refreshing}
      />

      {state.pageError && !state.deletingArtifact && (
        <div className="status-banner-danger relative z-10 flex items-center border-b px-6 py-3 text-sm">
          <span className="status-dot-danger mr-2 h-1.5 w-1.5 rounded-full" />
          {state.pageError}
        </div>
      )}

      <div className="relative z-10 flex-1 overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
        <div className="mx-auto max-w-[2000px]">
          <ScrapedDataList
            artifacts={state.filteredArtifacts}
            loading={state.isLoading}
            onViewDetails={handlers.handleViewDetails}
            onDownloadData={(a) => void handlers.handleDownloadData(a)}
            onDownloadManifest={(a) => void handlers.handleDownloadManifest(a)}
            onDelete={handlers.handleDeleteClick}
            emptyTitle={state.searchQuery.trim() ? 'No matching artifacts' : 'No scraped artifacts'}
            emptyDescription={
              state.searchQuery.trim()
                ? 'Try a different search term or clear the filter.'
                : 'Completed workflow scrape results will appear here.'
            }
          />
        </div>
      </div>

      <ScrapedDataDetailsSheet
        detailsArtifact={state.detailsArtifact}
        onClose={() => state.setDetailsArtifactId(null)}
        onDownloadData={handlers.handleDownloadData}
        onDownloadManifest={handlers.handleDownloadManifest}
        onDelete={handlers.handleDeleteClick}
        onOpenWorkflow={handlers.handleOpenWorkflow}
      />

      {state.deletingArtifact ? (
        <ConfirmDeleteDialog
          open={Boolean(state.deletingArtifact)}
          title="Delete Scrape Artifact"
          entityLabel="scrape artifact"
          itemName={state.deletingArtifact.name || 'Selected artifact'}
          confirmLabel="Delete Artifact"
          saving={state.savingDelete}
          error={state.pageError}
          extraDescription="Stored data and manifest files will be removed too."
          onConfirm={() => void handlers.handleConfirmDelete()}
          onCancel={() => {
            if (state.savingDelete) return
            state.setDeletingArtifactId(null)
          }}
        />
      ) : null}
    </div>
  )
}
