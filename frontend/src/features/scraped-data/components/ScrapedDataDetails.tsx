import { Download, GitBranch, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { WorkflowArtifact } from '../types'
import { formatDateTime, formatNumber, getArtifactRowCount, getArtifactTargets } from '../utils'

interface ScrapedDataDetailsProps {
  artifact: WorkflowArtifact
  onDownloadData: (artifact: WorkflowArtifact) => void
  onDownloadManifest: (artifact: WorkflowArtifact) => void
  onDelete: (artifact: WorkflowArtifact) => void
  onOpenWorkflow: (artifact: WorkflowArtifact) => void
}

export function ScrapedDataDetails({
  artifact,
  onDownloadData,
  onDownloadManifest,
  onDelete,
  onOpenWorkflow,
}: ScrapedDataDetailsProps) {
  const targets = getArtifactTargets(artifact)

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="space-y-5">
        {/* Header */}
        <div className="bg-panel-strong border-line rounded-2xl border p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-ink truncate text-lg font-semibold">
                {artifact.name || 'Untitled artifact'}
              </div>
              <div className="text-subtle-copy mt-1 text-sm">
                {artifact.workflowName}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Badge
                variant="outline"
                className="border-line bg-panel-muted text-copy"
              >
                {artifact.kind}
              </Badge>
              <Badge
                variant={artifact.imported ? 'default' : 'outline'}
                className={
                  artifact.imported
                    ? 'bg-status-success-soft text-status-success border-status-success-border'
                    : 'border-line bg-panel-muted text-copy'
                }
              >
                {artifact.imported ? 'Imported' : 'Unimported'}
              </Badge>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDownloadData(artifact)}
              disabled={!artifact.exportStorageId && !artifact.storageId}
            >
              <Download className="mr-2 h-4 w-4" />
              Download Data
            </Button>
            {artifact.manifestStorageId ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDownloadManifest(artifact)}
              >
                <Download className="mr-2 h-4 w-4" />
                Download Manifest
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenWorkflow(artifact)}
            >
              <GitBranch className="mr-2 h-4 w-4" />
              Open Workflow
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-status-danger-border text-status-danger hover:text-status-danger"
              onClick={() => onDelete(artifact)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="bg-panel-strong border-line rounded-2xl border p-4">
            <div className="text-subtle-copy text-[11px] font-semibold tracking-[0.16em] uppercase">
              Rows
            </div>
            <div className="text-ink mt-2 text-2xl font-semibold">
              {formatNumber(getArtifactRowCount(artifact))}
            </div>
          </div>
          <div className="bg-panel-strong border-line rounded-2xl border p-4">
            <div className="text-subtle-copy text-[11px] font-semibold tracking-[0.16em] uppercase">
              Chunks
            </div>
            <div className="text-ink mt-2 text-2xl font-semibold">
              {formatNumber(
                Math.max(0, Number(artifact.stats?.chunksCompleted ?? 0)),
              )}
            </div>
          </div>
        </div>

        {/* Metadata */}
        <div className="bg-panel-strong border-line rounded-2xl border p-4">
          <h4 className="text-muted-copy text-sm font-medium">Metadata</h4>
          <dl className="mt-3 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-subtle-copy">Node Label</dt>
              <dd className="text-ink text-right">
                {artifact.nodeLabel || artifact.nodeId}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-subtle-copy">Source Profile</dt>
              <dd className="text-ink text-right">
                {artifact.sourceProfileName || '-'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-subtle-copy">Status</dt>
              <dd className="text-ink text-right">
                {artifact.status || 'completed'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-subtle-copy">Last Run</dt>
              <dd className="text-ink text-right">
                {formatDateTime(artifact.lastRunAt)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-subtle-copy">Created</dt>
              <dd className="text-ink text-right">
                {formatDateTime(artifact.createdAt)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-subtle-copy">Updated</dt>
              <dd className="text-ink text-right">
                {formatDateTime(artifact.updatedAt)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-subtle-copy">Data File</dt>
              <dd className="text-ink text-right">
                {artifact.exportStorageId || artifact.storageId
                  ? 'Available'
                  : 'Missing'}
              </dd>
            </div>
            {artifact.manifestStorageId ? (
              <div className="flex justify-between gap-4">
                <dt className="text-subtle-copy">Manifest File</dt>
                <dd className="text-ink text-right">Available</dd>
              </div>
            ) : null}
          </dl>
        </div>

        {/* Targets */}
        <div className="bg-panel-strong border-line rounded-2xl border p-4">
          <h4 className="text-muted-copy text-sm font-medium">Targets</h4>
          {targets.length === 0 ? (
            <p className="text-subtle-copy mt-3 text-sm">
              No targets recorded.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {targets.map((target) => (
                <Badge
                  key={target}
                  variant="outline"
                  className="border-line bg-panel-muted text-copy"
                >
                  @{target}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
