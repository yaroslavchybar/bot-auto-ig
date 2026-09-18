import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Play, RefreshCw, Square } from 'lucide-react'
import type { Automation, AutomationStatus } from '../types'
import {
  getStatusColor,
  getStatusLabel,
  formatTimestamp,
  formatDuration,
} from '../types'

export interface AutomationDetailsProps {
  automation: Automation
  onToggleActive?: () => void
  onRun?: () => void
  onReset?: () => void
  onStopRun?: () => void
}

/* ── Active Toggle & Running Badge ── */

function ActiveToggleSection({
  isActive,
  isRunning,
  onToggleActive,
}: {
  isActive: boolean
  isRunning: boolean
  onToggleActive?: () => void
}) {
  return (
    <div className="bg-panel-subtle border-line-soft flex items-center justify-between rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <Switch
          checked={isActive}
          onCheckedChange={onToggleActive}
          className="brand-switch"
        />
        <div>
          <p className="text-ink font-medium">
            {isActive ? 'Active' : 'Disabled'}
          </p>
          <p className="text-subtle-copy text-xs">
            {isActive
              ? 'Automation can be started'
              : 'Disabled automations cannot be started'}
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
  )
}

/* ── Status & Action Buttons ── */

function StatusActionsSection({
  status,
  isRunning,
  isCompleted,
  isFailed,
  canRun,
  onRun,
  onStopRun,
  onReset,
}: {
  status: AutomationStatus | undefined
  isRunning: boolean
  isCompleted: boolean
  isFailed: boolean
  canRun: boolean
  onRun?: () => void
  onStopRun?: () => void
  onReset?: () => void
}) {
  return (
    <>
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
      <div className="flex flex-wrap gap-2">
        {!isRunning && (
          <Button
            size="sm"
            variant="outline"
            onClick={onRun}
            disabled={!canRun || !onRun}
            title={
              !canRun
                ? 'Enable the automation to run it'
                : !onRun
                  ? 'Run is unavailable'
                  : undefined
            }
          >
            <Play className="mr-2 h-4 w-4" />
            Run
          </Button>
        )}
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
            aria-label="Reset automation"
            title="Reset automation"
            className="h-8 w-8 shrink-0 p-0"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="sr-only">Reset</span>
          </Button>
        )}
      </div>
      <Separator className="bg-panel-muted" />
    </>
  )
}

/* ── Information Section ── */

function InformationSection({ automation }: { automation: Automation }) {
  return (
    <div>
      <h4 className="text-muted-copy mb-2 text-sm font-medium">
        Information
      </h4>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-subtle-copy">Nodes</dt>
          <dd className="text-ink">
            {Array.isArray(automation.nodes) ? automation.nodes.length : 0}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-subtle-copy">Edges</dt>
          <dd className="text-ink">
            {Array.isArray(automation.edges) ? automation.edges.length : 0}
          </dd>
        </div>
      </dl>
    </div>
  )
}

/* ── Execution History Section ── */

function ExecutionHistorySection({ automation }: { automation: Automation }) {
  return (
    <div>
      <h4 className="text-muted-copy mb-2 text-sm font-medium">
        Execution History
      </h4>
      <dl className="space-y-2 text-sm">
        {automation.lastRunAt && (
          <div className="flex justify-between">
            <dt className="text-subtle-copy">Last Run</dt>
            <dd className="text-ink">
              {formatTimestamp(automation.lastRunAt)}
            </dd>
          </div>
        )}
        {automation.startedAt && (
          <div className="flex justify-between">
            <dt className="text-subtle-copy">Started</dt>
            <dd className="text-ink">
              {formatTimestamp(automation.startedAt)}
            </dd>
          </div>
        )}
        {automation.completedAt && (
          <div className="flex justify-between">
            <dt className="text-subtle-copy">Completed</dt>
            <dd className="text-ink">
              {formatTimestamp(automation.completedAt)}
            </dd>
          </div>
        )}
        {automation.startedAt && (
          <div className="flex justify-between">
            <dt className="text-subtle-copy">Duration</dt>
            <dd className="text-ink">
              {formatDuration(automation.startedAt, automation.completedAt)}
            </dd>
          </div>
        )}
      </dl>
    </div>
  )
}

/* ── Error Section ── */

function ErrorSection({ error }: { error: string }) {
  return (
    <div>
      <h4 className="text-status-danger mb-2 text-sm font-medium">
        Error
      </h4>
      <p className="text-status-danger bg-status-danger-soft border-status-danger-border rounded-md border p-3 text-sm">
        {error}
      </p>
    </div>
  )
}

/* ── Timestamps Section ── */

function TimestampsSection({ automation }: { automation: Automation }) {
  return (
    <div>
      <h4 className="text-muted-copy mb-2 text-sm font-medium">
        Timestamps
      </h4>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-subtle-copy">Created</dt>
          <dd className="text-ink">
            {formatTimestamp(automation.createdAt)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-subtle-copy">Updated</dt>
          <dd className="text-ink">
            {formatTimestamp(automation.updatedAt)}
          </dd>
        </div>
      </dl>
    </div>
  )
}

/* ── Main Component ── */

export function AutomationDetails({
  automation,
  onToggleActive,
  onRun,
  onReset,
  onStopRun,
}: AutomationDetailsProps) {
  const status = automation.status as AutomationStatus | undefined
  const isRunning = status === 'running'
  const isFailed = status === 'failed'
  const isCompleted = status === 'completed'
  const isActive = automation.isActive ?? true
  const canRun = isActive && !isRunning && status !== 'pending'

  return (
    <div className="text-ink space-y-6 p-6">
      <div>
        <h3 className="text-ink text-lg font-semibold">{automation.name}</h3>
        {automation.description && (
          <p className="text-subtle-copy mt-1 text-sm">
            {automation.description}
          </p>
        )}
      </div>

      <>
        <ActiveToggleSection
          isActive={isActive}
          isRunning={isRunning}
          onToggleActive={onToggleActive}
        />
        <StatusActionsSection
          status={status}
          isRunning={isRunning}
          isCompleted={isCompleted}
          isFailed={isFailed}
          canRun={canRun}
          onRun={onRun}
          onStopRun={onStopRun}
          onReset={onReset}
        />
      </>

      <div className="space-y-4">
        <InformationSection automation={automation} />
        <ExecutionHistorySection automation={automation} />
        {automation.error && <ErrorSection error={automation.error} />}
        <TimestampsSection automation={automation} />
      </div>
    </div>
  )
}
