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

export function ScrapedDataPageContainer() {
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
          artifact.name,
          artifact.workflowName,
          artifact.nodeLabel,
          artifact.sourceProfileName,
          artifact.targetUsername,
          artifact.kind,
        ]
          .map((value) => String(value || '').toLowerCase())
          .join(' ')
        return haystack.includes(query)
      })
  }, [visibleArtifacts, searchQuery])

  const detailsArtifact =
    visibleArtifacts.find((artifact) => artifact._id === detailsArtifactId) ?? null
  const deletingArtifact =
    visibleArtifacts.find((artifact) => artifact._id === deletingArtifactId) ?? null

  const downloadArtifact = useCallback(
    async (storageId: Id<'_storage'> | null | undefined, fileName: string) => {
      if (!storageId) {
        throw new Error('Artifact file is not available')
      }
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
        setPageError(message)
        toast.error(message)
      }
    },
    [downloadArtifact],
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
        setPageError(message)
        toast.error(message)
      }
    },
    [downloadArtifact],
  )

  const handleViewDetails = useCallback((artifact: WorkflowArtifact) => {
    setDetailsArtifactId(artifact._id)
    setPageError(null)
  }, [])

  const handleDeleteClick = useCallback((artifact: WorkflowArtifact) => {
    setDeletingArtifactId(artifact._id)
    setPageError(null)
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (!deletingArtifactId) return
    setSavingDelete(true)
    setPageError(null)
    try {
      const removed = await removeArtifact({ id: deletingArtifactId })
      setHiddenArtifactIds((current) =>
        current.includes(deletingArtifactId) ? current : [...current, deletingArtifactId],
      )
      toast.success(`Deleted "${removed.name}"`)
      if (detailsArtifactId === deletingArtifactId) {
        setDetailsArtifactId(null)
      }
      setDeletingArtifactId(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setPageError(message)
      toast.error(message)
    } finally {
      setSavingDelete(false)
    }
  }, [deletingArtifactId, detailsArtifactId, removeArtifact])

  const handleOpenWorkflow = useCallback(
    (artifact: WorkflowArtifact) => {
      navigate(`/workflows/${artifact.workflowId}/editor`)
    },
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
    } finally {
      setRefreshing(false)
    }
  }, [convex])

  return (
    <div className="bg-shell text-ink animate-in fade-in relative flex h-full flex-col duration-300">
      <AmbientGlow />

      {/* Header */}
      <div className="relative z-10 flex-none px-4 pt-2 pb-2 md:px-6 md:pt-3 md:pb-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
          <div className="flex flex-grow items-center gap-2">
            <div className="relative flex-1 sm:w-[280px] sm:flex-initial">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-copy" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search..."
                className="bg-field border border-line text-copy placeholder:text-muted-copy brand-focus h-8 rounded-md pl-9 text-sm font-normal leading-5 shadow-sm"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => void handleRefresh()}
              disabled={isLoading || refreshing}
              aria-label="Refresh artifacts"
              title="Refresh artifacts"
              className="h-8 w-8 shrink-0 p-0"
            >
              <RefreshCw
                className={
                  isLoading || refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'
                }
              />
              <span className="sr-only">Refresh</span>
            </Button>
          </div>
        </div>
      </div>

      {pageError && !deletingArtifact && (
        <div className="status-banner-danger relative z-10 flex items-center border-b px-6 py-3 text-sm">
          <span className="status-dot-danger mr-2 h-1.5 w-1.5 rounded-full" />
          {pageError}
        </div>
      )}

      {/* Main Content */}
      <div className="relative z-10 flex-1 overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
        <div className="mx-auto max-w-[2000px]">
          <ScrapedDataList
            artifacts={filteredArtifacts}
            loading={isLoading}
            onViewDetails={handleViewDetails}
            onDownloadData={(a) => void handleDownloadData(a)}
            onDownloadManifest={(a) => void handleDownloadManifest(a)}
            onDelete={handleDeleteClick}
            emptyTitle={
              searchQuery.trim()
                ? 'No matching artifacts'
                : 'No scraped artifacts'
            }
            emptyDescription={
              searchQuery.trim()
                ? 'Try a different search term or clear the filter.'
                : 'Completed workflow scrape results will appear here.'
            }
          />
        </div>
      </div>

      {/* Details Sheet */}
      <Sheet
        open={Boolean(detailsArtifact)}
        onOpenChange={(open) => {
          if (!open) setDetailsArtifactId(null)
        }}
      >
        <SheetContent className="border-line bg-panel text-ink flex w-full max-w-full flex-col gap-0 border-l p-0 shadow-xl sm:w-[540px]">
          <SheetHeader className="border-line-soft bg-panel-subtle border-b p-6 pb-4">
            <SheetTitle className="page-title-gradient">
              Artifact Details
            </SheetTitle>
          </SheetHeader>
          {detailsArtifact ? (
            <ScrapedDataDetails
              artifact={detailsArtifact}
              onDownloadData={(a) => void handleDownloadData(a)}
              onDownloadManifest={(a) => void handleDownloadManifest(a)}
              onDelete={handleDeleteClick}
              onOpenWorkflow={handleOpenWorkflow}
            />
          ) : (
            <div className="text-muted-foreground p-8 text-center text-sm">
              Artifact unavailable.
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete Dialog */}
      {deletingArtifact ? (
        <ConfirmDeleteDialog
          open={Boolean(deletingArtifact)}
          title="Delete Scrape Artifact"
          entityLabel="scrape artifact"
          itemName={deletingArtifact.name || 'Selected artifact'}
          confirmLabel="Delete Artifact"
          saving={savingDelete}
          error={pageError}
          extraDescription="Stored data and manifest files will be removed too."
          onConfirm={() => void handleConfirmDelete()}
          onCancel={() => {
            if (savingDelete) return
            setDeletingArtifactId(null)
          }}
        />
      ) : null}
    </div>
  )
}
