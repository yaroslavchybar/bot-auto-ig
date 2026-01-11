import { useEffect, useState } from 'react'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import type { Workflow, ScheduleType, ScheduleConfig } from './types'

interface ScheduleDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	workflow: Workflow | null
	saving?: boolean
	onSave: (data: {
		scheduleType: ScheduleType
		scheduleConfig: ScheduleConfig
		maxRunsPerDay?: number
		timezone?: string
	}) => void
}

const DAY_OPTIONS = [
	{ value: 0, label: 'Sunday' },
	{ value: 1, label: 'Monday' },
	{ value: 2, label: 'Tuesday' },
	{ value: 3, label: 'Wednesday' },
	{ value: 4, label: 'Thursday' },
	{ value: 5, label: 'Friday' },
	{ value: 6, label: 'Saturday' },
]

const TIMEZONE_OPTIONS = [
	{ value: 'UTC', label: 'UTC' },
	{ value: 'America/New_York', label: 'Eastern Time (US)' },
	{ value: 'America/Chicago', label: 'Central Time (US)' },
	{ value: 'America/Denver', label: 'Mountain Time (US)' },
	{ value: 'America/Los_Angeles', label: 'Pacific Time (US)' },
	{ value: 'Europe/London', label: 'London (UK)' },
	{ value: 'Europe/Paris', label: 'Paris (CET)' },
	{ value: 'Europe/Berlin', label: 'Berlin (CET)' },
	{ value: 'Europe/Moscow', label: 'Moscow' },
	{ value: 'Europe/Kiev', label: 'Kyiv (Ukraine)' },
	{ value: 'Asia/Dubai', label: 'Dubai (UAE)' },
	{ value: 'Asia/Kolkata', label: 'India (IST)' },
	{ value: 'Asia/Shanghai', label: 'China (CST)' },
	{ value: 'Asia/Tokyo', label: 'Tokyo (Japan)' },
	{ value: 'Australia/Sydney', label: 'Sydney (Australia)' },
]

export function ScheduleDialog({
	open,
	onOpenChange,
	workflow,
	saving,
	onSave,
}: ScheduleDialogProps) {
	const [scheduleType, setScheduleType] = useState<ScheduleType>('daily')
	const [intervalMinutes, setIntervalMinutes] = useState(60)
	const [hourUTC, setHourUTC] = useState(9)
	const [minuteUTC, setMinuteUTC] = useState(0)
	const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5])
	const [dayOfMonth, setDayOfMonth] = useState(1)
	const [cronspec, setCronspec] = useState('0 9 * * *')
	const [maxRunsPerDay, setMaxRunsPerDay] = useState<number | undefined>(undefined)
	const [timezone, setTimezone] = useState('UTC')

	useEffect(() => {
		if (workflow && open) {
			const config = (workflow.scheduleConfig || {}) as ScheduleConfig
			setScheduleType((workflow.scheduleType as ScheduleType) || 'daily')
			setIntervalMinutes(Math.round((config.intervalMs || 3600000) / 60000))
			setHourUTC(config.hourUTC ?? 9)
			setMinuteUTC(config.minuteUTC ?? 0)
			setDaysOfWeek(config.daysOfWeek ?? [1, 2, 3, 4, 5])
			setDayOfMonth(config.dayOfMonth ?? 1)
			setCronspec(config.cronspec ?? '0 9 * * *')
			setMaxRunsPerDay(workflow.maxRunsPerDay)
			setTimezone(workflow.timezone ?? 'UTC')
		}
	}, [workflow, open])

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault()

		const scheduleConfig: ScheduleConfig = {}

		switch (scheduleType) {
			case 'interval':
				scheduleConfig.intervalMs = intervalMinutes * 60000
				break
			case 'daily':
				scheduleConfig.hourUTC = hourUTC
				scheduleConfig.minuteUTC = minuteUTC
				break
			case 'weekly':
				scheduleConfig.hourUTC = hourUTC
				scheduleConfig.minuteUTC = minuteUTC
				scheduleConfig.daysOfWeek = daysOfWeek
				break
			case 'monthly':
				scheduleConfig.hourUTC = hourUTC
				scheduleConfig.minuteUTC = minuteUTC
				scheduleConfig.dayOfMonth = dayOfMonth
				break
			case 'cron':
				scheduleConfig.cronspec = cronspec
				break
		}

		onSave({
			scheduleType,
			scheduleConfig,
			maxRunsPerDay: maxRunsPerDay && maxRunsPerDay > 0 ? maxRunsPerDay : undefined,
			timezone: timezone !== 'UTC' ? timezone : undefined,
		})
	}

	const toggleDay = (day: number) => {
		setDaysOfWeek((prev) =>
			prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
		)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>Schedule Settings</DialogTitle>
					<DialogDescription>
						Configure when this workflow should run automatically.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label>Schedule Type</Label>
						<Select value={scheduleType} onValueChange={(v) => setScheduleType(v as ScheduleType)}>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="interval">Interval (every X minutes)</SelectItem>
								<SelectItem value="daily">Daily</SelectItem>
								<SelectItem value="weekly">Weekly</SelectItem>
								<SelectItem value="monthly">Monthly</SelectItem>
								<SelectItem value="cron">Custom Cron</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{scheduleType === 'interval' && (
						<div className="space-y-2">
							<Label>Run every (minutes)</Label>
							<Input
								type="number"
								min={1}
								max={1440}
								value={intervalMinutes}
								onChange={(e) => setIntervalMinutes(Number(e.target.value))}
							/>
							<p className="text-xs text-muted-foreground">
								{intervalMinutes >= 60
									? `Every ${Math.round(intervalMinutes / 60)} hour(s)`
									: `Every ${intervalMinutes} minute(s)`}
							</p>
						</div>
					)}

					{(scheduleType === 'daily' || scheduleType === 'weekly' || scheduleType === 'monthly') && (
						<>
							<div className="space-y-2">
								<Label>Timezone</Label>
								<Select value={timezone} onValueChange={setTimezone}>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{TIMEZONE_OPTIONS.map((tz) => (
											<SelectItem key={tz.value} value={tz.value}>
												{tz.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							<div className="grid grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label>Hour</Label>
									<Input
										type="number"
										min={0}
										max={23}
										value={hourUTC}
										onChange={(e) => setHourUTC(Number(e.target.value))}
									/>
								</div>
								<div className="space-y-2">
									<Label>Minute</Label>
									<Input
										type="number"
										min={0}
										max={59}
										value={minuteUTC}
										onChange={(e) => setMinuteUTC(Number(e.target.value))}
									/>
								</div>
							</div>
						</>
					)}

					{scheduleType === 'weekly' && (
						<div className="space-y-2">
							<Label>Days of Week</Label>
							<div className="grid grid-cols-4 gap-2">
								{DAY_OPTIONS.map((day) => (
									<div key={day.value} className="flex items-center space-x-2">
										<Checkbox
											id={`day-${day.value}`}
											checked={daysOfWeek.includes(day.value)}
											onCheckedChange={() => toggleDay(day.value)}
										/>
										<label
											htmlFor={`day-${day.value}`}
											className="text-sm cursor-pointer"
										>
											{day.label.slice(0, 3)}
										</label>
									</div>
								))}
							</div>
						</div>
					)}

					{scheduleType === 'monthly' && (
						<div className="space-y-2">
							<Label>Day of Month</Label>
							<Input
								type="number"
								min={1}
								max={31}
								value={dayOfMonth}
								onChange={(e) => setDayOfMonth(Number(e.target.value))}
							/>
						</div>
					)}

					{scheduleType === 'cron' && (
						<div className="space-y-2">
							<Label>Cron Expression</Label>
							<Input
								value={cronspec}
								onChange={(e) => setCronspec(e.target.value)}
								placeholder="0 9 * * *"
							/>
							<p className="text-xs text-muted-foreground">
								Format: minute hour day-of-month month day-of-week
							</p>
						</div>
					)}

					<div className="space-y-2">
						<Label>Max Runs Per Day (optional)</Label>
						<Input
							type="number"
							min={0}
							value={maxRunsPerDay ?? ''}
							onChange={(e) => setMaxRunsPerDay(e.target.value ? Number(e.target.value) : undefined)}
							placeholder="Unlimited"
						/>
						<p className="text-xs text-muted-foreground">
							Leave empty for unlimited runs
						</p>
					</div>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={saving}>
							{saving ? 'Saving...' : 'Save Schedule'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
