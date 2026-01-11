import type { Doc } from '../../../../convex/_generated/dataModel'

export type WorkflowStatus = 'idle' | 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

export type Workflow = Doc<'workflows'>
export type WorkflowLog = Doc<'workflowLogs'>

export function getStatusColor(status?: WorkflowStatus): BadgeVariant {
	switch (status) {
		case 'idle': return 'secondary'
		case 'pending': return 'outline'
		case 'running': return 'default'
		case 'paused': return 'outline'
		case 'completed': return 'default'
		case 'failed': return 'destructive'
		case 'cancelled': return 'secondary'
		default: return 'secondary'
	}
}

export function getStatusLabel(status?: WorkflowStatus): string {
	switch (status) {
		case 'idle': return 'Idle'
		case 'pending': return 'Pending'
		case 'running': return 'Running'
		case 'paused': return 'Paused'
		case 'completed': return 'Completed'
		case 'failed': return 'Failed'
		case 'cancelled': return 'Cancelled'
		default: return '—'
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

export type ScheduleType = 'interval' | 'daily' | 'weekly' | 'monthly' | 'cron'

export type ScheduleConfig = {
	intervalMs?: number
	hourUTC?: number
	minuteUTC?: number
	daysOfWeek?: number[]
	dayOfMonth?: number
	cronspec?: string
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function formatSchedule(scheduleType?: ScheduleType | string, config?: ScheduleConfig): string {
	if (!scheduleType) return 'Not configured'

	const cfg = config || {}
	const hour = cfg.hourUTC ?? 9
	const minute = cfg.minuteUTC ?? 0
	const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} UTC`

	switch (scheduleType) {
		case 'interval': {
			const ms = cfg.intervalMs ?? 3600000
			if (ms < 60000) return `Every ${Math.round(ms / 1000)}s`
			if (ms < 3600000) return `Every ${Math.round(ms / 60000)}m`
			return `Every ${Math.round(ms / 3600000)}h`
		}
		case 'daily':
			return `Daily at ${timeStr}`
		case 'weekly': {
			const days = cfg.daysOfWeek?.length
				? cfg.daysOfWeek.map(d => DAY_NAMES[d]).join(', ')
				: 'Mon-Fri'
			return `${days} at ${timeStr}`
		}
		case 'monthly': {
			const day = cfg.dayOfMonth ?? 1
			return `Day ${day} at ${timeStr}`
		}
		case 'cron':
			return cfg.cronspec ?? 'Custom cron'
		default:
			return 'Unknown'
	}
}
