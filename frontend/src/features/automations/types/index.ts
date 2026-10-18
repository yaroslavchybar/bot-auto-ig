import type { Doc } from '../../../../../convex/_generated/dataModel'

export type AutomationStatus =
  | 'idle'
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

export type Automation = Doc<'automations'>

type DisplayStatus = AutomationStatus | 'waiting'

// Enabled routines wait between browser sessions; a terminal status belongs to the previous run.
export function getAutomationDisplayStatus(automation: Automation): DisplayStatus | undefined {
  if (
    automation.routine &&
    automation.isActive &&
    (automation.status === 'idle' ||
      automation.status === 'pending' ||
      automation.status === 'completed' ||
      automation.status === 'cancelled')
  )
    return 'waiting'
  return automation.status
}

export function getStatusColor(status?: DisplayStatus): BadgeVariant {
  switch (status) {
    case 'idle':
      return 'secondary'
    case 'pending':
    case 'waiting':
      return 'outline'
    case 'running':
      return 'default'
    case 'paused':
      return 'outline'
    case 'completed':
      return 'default'
    case 'failed':
      return 'destructive'
    case 'cancelled':
      return 'secondary'
    default:
      return 'secondary'
  }
}

export function getStatusLabel(status?: DisplayStatus): string {
  switch (status) {
    case 'idle':
      return 'Idle'
    case 'pending':
      return 'Pending'
    case 'waiting':
      return 'Waiting'
    case 'running':
      return 'Running'
    case 'paused':
      return 'Paused'
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
    default:
      return '—'
  }
}

export function formatTimestamp(ts?: number): string {
  if (!ts || !Number.isFinite(ts)) return '—'
  return new Date(ts).toLocaleString()
}
