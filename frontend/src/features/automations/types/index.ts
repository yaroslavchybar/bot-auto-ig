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

export function getStatusColor(status?: AutomationStatus): BadgeVariant {
  switch (status) {
    case 'idle':
      return 'secondary'
    case 'pending':
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

export function getStatusLabel(status?: AutomationStatus): string {
  switch (status) {
    case 'idle':
      return 'Idle'
    case 'pending':
      return 'Pending'
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

export function formatDuration(startMs?: number, endMs?: number): string {
  if (!startMs) return '—'
  const end = endMs || Date.now()
  const diffMs = end - startMs
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}


