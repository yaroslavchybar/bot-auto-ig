import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Clock, Download, RefreshCw, Settings2, Square } from 'lucide-react'
import type { Workflow, WorkflowStatus, ScheduleConfig } from '../types'
import {
  getStatusColor,
  getStatusLabel,
  formatTimestamp,
  formatDuration,
  formatSchedule,
} from '../types'

export interface WorkflowDetailsProps {
  workflow: Workflow
  artifacts?: Array<{
    _id: string
    name: string
    nodeLabel?: string | null
    kind: 'followers' | 'following'
    targets?: string[]
    targetUsername?: string | null
    status?: string | null
    storageId?: string | null
    manifestStorageId?: string | null
    exportStorageId?: string | null
    sourceProfileName?: string | null
    lastRunAt?: number | null
    stats?: {
      scraped?: number
      deduped?: number
      chunksCompleted?: number
      targetsCompleted?: number
    } | null
  }>
  artifactsLoading?: boolean
  onDownloadArtifact?: (
    storageId: string,
    fileName: string,
  ) => void
  onToggleActive?: () => void
  onEditSchedule?: () => void
  onReset?: () => void
  onStopRun?: () => void
}

export function WorkflowDetails({
  workflow,
  artifacts = [],
  artifactsLoading = false,
  onDownloadArtifact,
  onToggleActive,
  onEditSchedule,
  onReset,
  onStopRun,
}: WorkflowDetailsProps) {
  const status = workflow.status as WorkflowStatus | undefined
  const isRunning = status === 'running'
  const isFailed = status === 'failed'
  const isCompleted = status === 'completed'
  const isActive = workflow.isActive ?? false
  const hasSchedule = !!workflow.scheduleType
  const canToggleActive = hasSchedule && (!isRunning || isActive)
  const rawNodeStates =
    workflow.nodeStates && typeof workflow.nodeStates === 'object'
      ? workflow.nodeStates
      : {}
  const scrapeNodeStates = Object.entries(rawNodeStates).filter(([, state]) => {
    return (
      state &&
      typeof state === 'object' &&
      ((state as Record<string, unknown>).activityId === 'scrape_relationships' ||
        typeof (state as Record<string, unknown>).artifactStorageId === 'string' ||
        typeof (state as Record<string, unknown>).manifestStorageId === 'string')
    )
  })

  return (
    <div className="text-ink space-y-6 p-6">
      {/* Header */}
      <div>
        <h3 className="text-ink text-lg font-semibold">{workflow.name}</h3>
        {workflow.description && (
          <p className="text-subtle-copy mt-1 text-sm">
            {workflow.description}
          </p>
        )}
      </div>

      {/* Active Toggle & Schedule */}
      <>
        <div className="bg-panel-subtle border-line-soft flex items-center justify-between rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <Switch
              checked={isActive}
              onCheckedChange={onToggleActive}
              disabled={!canToggleActive}
              className="brand-switch"
            />
            <div>
              <p className="text-ink font-medium">
                {isActive ? 'Active' : 'Inactive'}
              </p>
              <p className="text-subtle-copy text-xs">
                {isActive
                  ? 'Workflow is scheduled to run'
                  : 'Workflow will not run automatically'}
              </p>
            </div>
          </div>
          {isRunning && (
            <Badge
              variant="default"
              className="bg-status-success-soft text-status-success border-status-success-border hover:bg-status-success-strong"
            >
              Running
            </Badge>
          )}
        </div>

        {/* Schedule Info */}
        <div className="border-line-soft bg-panel-subtle space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="text-subtle-copy h-4 w-4" />
              <span className="text-ink font-medium">Schedule</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={onEditSchedule}
            >
              <Settings2 className="mr-1 h-4 w-4" />
              {hasSchedule ? 'Edit' : 'Configure'}
            </Button>
          </div>
          <div className="text-copy text-sm">
            {hasSchedule ? (
              <>
                <p>
                  {formatSchedule(
                    workflow.scheduleType,
                    workflow.scheduleConfig as ScheduleConfig,
                    workflow.timezone,
                  )}
                </p>
                {workflow.maxRunsPerDay && (
                  <p className="text-subtle-copy mt-1">
                    Limit: {workflow.runsToday ?? 0}/{workflow.maxRunsPerDay}{' '}
                    runs today
                  </p>
                )}
              </>
            ) : (
              <p className="text-subtle-copy">No schedule configured</p>
            )}
          </div>
        </div>

        {/* Status */}
        {status && status !== 'idle' && (
          <div className="flex items-center gap-3">
            <Badge
              variant={getStatusColor(status)}
              className={`text-sm ${
                status === 'running' || status === 'completed'
                  ? 'bg-status-success-soft text-status-success border-status-success-border'
                  : status === 'failed'
                    ? 'bg-status-danger-soft text-status-danger border-status-danger-border'
                    : status === 'cancelled'
                      ? 'bg-status-warning-soft text-status-warning border-status-warning-border'
                      : ''
              }`}
            >
              {getStatusLabel(status)}
            </Badge>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {isRunning && (
            <Button
              size="sm"
              variant="destructive"
              onClick={onStopRun}
              className="bg-status-danger-strong text-status-danger hover:bg-status-danger-strong border-status-danger-border border"
            >
              <Square className="mr-2 h-4 w-4" />
              Stop
            </Button>
          )}
          {(isCompleted || isFailed || status === 'cancelled') && (
            <Button
              size="icon"
              variant="outline"
              onClick={onReset}
              aria-label="Reset workflow"
              title="Reset workflow"
              className="h-8 w-8 shrink-0 p-0"
            >
              <RefreshCw className="h-4 w-4" />
              <span className="sr-only">Reset</span>
            </Button>
          )}
        </div>

        <Separator className="bg-panel-muted" />
      </>

      {/* Info */}
      <div className="space-y-4">
        <div>
          <h4 className="text-muted-copy mb-2 text-sm font-medium">
            Information
          </h4>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-subtle-copy">Nodes</dt>
              <dd className="text-ink">
                {Array.isArray(workflow.nodes) ? workflow.nodes.length : 0}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-subtle-copy">Edges</dt>
              <dd className="text-ink">
                {Array.isArray(workflow.edges) ? workflow.edges.length : 0}
              </dd>
            </div>
          </dl>
        </div>

        <div>
          <h4 className="text-muted-copy mb-2 text-sm font-medium">
            Execution History
          </h4>
          <dl className="space-y-2 text-sm">
            {workflow.lastRunAt && (
              <div className="flex justify-between">
                <dt className="text-subtle-copy">Last Run</dt>
                <dd className="text-ink">
                  {formatTimestamp(workflow.lastRunAt)}
                </dd>
              </div>
            )}
            {workflow.startedAt && (
              <div className="flex justify-between">
                <dt className="text-subtle-copy">Started</dt>
                <dd className="text-ink">
                  {formatTimestamp(workflow.startedAt)}
                </dd>
              </div>
            )}
            {workflow.completedAt && (
              <div className="flex justify-between">
                <dt className="text-subtle-copy">Completed</dt>
                <dd className="text-ink">
                  {formatTimestamp(workflow.completedAt)}
                </dd>
              </div>
            )}
            {workflow.startedAt && (
              <div className="flex justify-between">
                <dt className="text-subtle-copy">Duration</dt>
                <dd className="text-ink">
                  {formatDuration(workflow.startedAt, workflow.completedAt)}
                </dd>
              </div>
            )}
            {workflow.runsToday !== undefined && workflow.runsToday > 0 && (
              <div className="flex justify-between">
                <dt className="text-subtle-copy">Runs Today</dt>
                <dd className="text-ink">{workflow.runsToday}</dd>
              </div>
            )}
          </dl>
        </div>

        {workflow.error && (
          <div>
            <h4 className="text-status-danger mb-2 text-sm font-medium">
              Error
            </h4>
            <p className="text-status-danger bg-status-danger-soft border-status-danger-border rounded-md border p-3 text-sm">
              {workflow.error}
            </p>
          </div>
        )}

        <div>
          <h4 className="text-muted-copy mb-2 text-sm font-medium">
            Scrape Node State
          </h4>
          {scrapeNodeStates.length === 0 ? (
            <p className="text-subtle-copy text-sm">
              No scrape node state recorded yet.
            </p>
          ) : (
            <div className="space-y-3">
              {scrapeNodeStates.map(([nodeId, state]) => {
                const record = state as Record<string, unknown>
                const targets = Array.isArray(record.targets)
                  ? record.targets
                      .map((value) => String(value ?? '').trim())
                      .filter(Boolean)
                  : []
                return (
                  <div
                    key={nodeId}
                    className="border-line-soft bg-panel-subtle rounded-lg border p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-ink text-sm font-medium">
                          {String(record.label ?? nodeId)}
                        </p>
                        <p className="text-subtle-copy text-xs">
                          {String(record.kind ?? 'followers')} ·{' '}
                          {targets.length} target(s)
                        </p>
                      </div>
                      <Badge variant="outline">
                        {String(record.status ?? 'idle')}
                      </Badge>
                    </div>
                    <div className="text-subtle-copy mt-2 text-xs">
                      Scraped: {Number(record.scraped ?? 0) || 0}
                    </div>
                    {typeof record.lastError === 'string' &&
                    record.lastError.trim() ? (
                      <p className="text-status-danger mt-2 text-xs">
                        {record.lastError}
                      </p>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div>
          <h4 className="text-muted-copy mb-2 text-sm font-medium">
            Scrape Results
          </h4>
          {artifactsLoading ? (
            <p className="text-subtle-copy text-sm">Loading artifacts...</p>
          ) : artifacts.length === 0 ? (
            <p className="text-subtle-copy text-sm">
              No scrape artifacts available for this workflow yet.
            </p>
          ) : (
            <div className="space-y-3">
              {artifacts.map((artifact) => {
                const targets =
                  Array.isArray(artifact.targets) && artifact.targets.length > 0
                    ? artifact.targets
                    : String(artifact.targetUsername || '')
                        .split(/\r?\n/)
                        .map((value) => value.trim())
                        .filter(Boolean)
                const exportStorageId = artifact.exportStorageId || artifact.storageId
                const manifestStorageId = artifact.manifestStorageId || null
                const scrapedCount = artifact.stats?.deduped ?? artifact.stats?.scraped ?? 0
                return (
                  <div
                    key={artifact._id}
                    className="border-line-soft bg-panel-subtle rounded-lg border p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-ink text-sm font-medium">
                          {artifact.nodeLabel || artifact.name}
                        </p>
                        <p className="text-subtle-copy text-xs">
                          {artifact.kind} · {targets.length} target(s)
                        </p>
                      </div>
                      <Badge variant="outline">
                        {artifact.status || 'completed'}
                      </Badge>
                    </div>
                    <div className="text-subtle-copy mt-2 space-y-1 text-xs">
                      <p>Rows: {scrapedCount}</p>
                      {artifact.sourceProfileName ? (
                        <p>Profile: {artifact.sourceProfileName}</p>
                      ) : null}
                      {artifact.lastRunAt ? (
                        <p>Last Run: {formatTimestamp(artifact.lastRunAt)}</p>
                      ) : null}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {exportStorageId && onDownloadArtifact ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            onDownloadArtifact(
                              exportStorageId,
                              `${artifact.name || artifact.nodeLabel || 'scrape-result'}.json`,
                            )
                          }
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Download Data
                        </Button>
                      ) : null}
                      {manifestStorageId && onDownloadArtifact ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            onDownloadArtifact(
                              manifestStorageId,
                              `${artifact.name || artifact.nodeLabel || 'scrape-result'}_manifest.json`,
                            )
                          }
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Download Manifest
                        </Button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div>
          <h4 className="text-muted-copy mb-2 text-sm font-medium">
            Timestamps
          </h4>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-subtle-copy">Created</dt>
              <dd className="text-ink">
                {formatTimestamp(workflow.createdAt)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-subtle-copy">Updated</dt>
              <dd className="text-ink">
                {formatTimestamp(workflow.updatedAt)}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  )
}



