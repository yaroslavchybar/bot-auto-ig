import { useState } from 'react'
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
import type { Workflow, ScheduleType, ScheduleConfig } from '../types'

// Convert local hour/minute in a timezone to UTC hour/minute
function localToUTC(
  hour: number,
  minute: number,
  tz: string,
): { hourUTC: number; minuteUTC: number } {
  if (tz === 'UTC') return { hourUTC: hour, minuteUTC: minute }
  const now = new Date()
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`
  const utcDate = new Date(dateStr + 'Z')
  const localStr = utcDate.toLocaleString('en-US', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
  const [refH, refM] = localStr.split(':').map(Number)
  const offsetMinutes = refH * 60 + refM - (hour * 60 + minute)
  let targetMinutes = hour * 60 + minute - offsetMinutes
  targetMinutes = ((targetMinutes % 1440) + 1440) % 1440
  return {
    hourUTC: Math.floor(targetMinutes / 60),
    minuteUTC: targetMinutes % 60,
  }
}

// Convert UTC hour/minute to local hour/minute in a timezone
function utcToLocal(
  hourUTC: number,
  minuteUTC: number,
  tz: string,
): { hour: number; minute: number } {
  if (tz === 'UTC') return { hour: hourUTC, minute: minuteUTC }
  const now = new Date()
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(hourUTC).padStart(2, '0')}:${String(minuteUTC).padStart(2, '0')}:00Z`
  const utcDate = new Date(dateStr)
  const localStr = utcDate.toLocaleString('en-US', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
  const [h, m] = localStr.split(':').map(Number)
  return { hour: h === 24 ? 0 : h, minute: m }
}

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
  workflow,
  ...props
}: ScheduleDialogProps) {
  const resetKey = `${workflow?._id ?? 'schedule'}-${open ? 'open' : 'closed'}`

  return (
    <ScheduleDialogInner
      key={resetKey}
      open={open}
      workflow={workflow}
      {...props}
    />
  )
}

/* ── Schedule Type Select ── */

function ScheduleTypeField({
  scheduleType,
  onScheduleTypeChange,
}: {
  scheduleType: ScheduleType
  onScheduleTypeChange: (v: ScheduleType) => void
}) {
  return (
    <div className="space-y-2">
      <Label className="text-muted-copy">Schedule Type</Label>
      <Select
        value={scheduleType}
        onValueChange={(v) => onScheduleTypeChange(v as ScheduleType)}
      >
        <SelectTrigger className="brand-focus bg-field border-line text-ink">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="panel-dropdown">
          <SelectItem value="interval">Interval (every X minutes)</SelectItem>
          <SelectItem value="daily">Daily</SelectItem>
          <SelectItem value="weekly">Weekly</SelectItem>
          <SelectItem value="monthly">Monthly</SelectItem>
          <SelectItem value="cron">Custom Cron</SelectItem>
          <SelectItem value="instant">Instant Run</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

/* ── Interval Fields ── */

function IntervalFields({
  intervalMinutes,
  onIntervalChange,
}: {
  intervalMinutes: number
  onIntervalChange: (v: number) => void
}) {
  return (
    <div className="space-y-2">
      <Label className="text-muted-copy">Run every (minutes)</Label>
      <Input
        type="number"
        min={1}
        max={1440}
        value={intervalMinutes}
        onChange={(e) => onIntervalChange(Number(e.target.value))}
        className="brand-focus bg-field border-line text-ink"
      />
      <p className="text-subtle-copy text-xs">
        {intervalMinutes >= 60
          ? `Every ${Math.round(intervalMinutes / 60)} hour(s)`
          : `Every ${intervalMinutes} minute(s)`}
      </p>
    </div>
  )
}

/* ── Timezone + Hour/Minute Fields ── */

function TimeFields({
  timezone,
  hourUTC,
  minuteUTC,
  onTimezoneChange,
  onHourChange,
  onMinuteChange,
}: {
  timezone: string
  hourUTC: number
  minuteUTC: number
  onTimezoneChange: (v: string) => void
  onHourChange: (v: number) => void
  onMinuteChange: (v: number) => void
}) {
  return (
    <>
      <div className="space-y-2">
        <Label className="text-muted-copy">Timezone</Label>
        <Select value={timezone} onValueChange={onTimezoneChange}>
          <SelectTrigger className="brand-focus bg-field border-line text-ink">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="panel-dropdown">
            {TIMEZONE_OPTIONS.map((tz) => (
              <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-muted-copy">Hour</Label>
          <Input
            type="number" min={0} max={23} value={hourUTC}
            onChange={(e) => onHourChange(Number(e.target.value))}
            className="brand-focus bg-field border-line text-ink"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-muted-copy">Minute</Label>
          <Input
            type="number" min={0} max={59} value={minuteUTC}
            onChange={(e) => onMinuteChange(Number(e.target.value))}
            className="brand-focus bg-field border-line text-ink"
          />
        </div>
      </div>
    </>
  )
}

/* ── Weekly Days Selector ── */

function WeeklyDaysField({
  daysOfWeek,
  onToggleDay,
}: {
  daysOfWeek: number[]
  onToggleDay: (day: number) => void
}) {
  return (
    <div className="space-y-2">
      <Label className="text-muted-copy">Days of Week</Label>
      <div className="grid grid-cols-4 gap-2">
        {DAY_OPTIONS.map((day) => (
          <div key={day.value} className="flex items-center space-x-2">
            <Checkbox
              id={`day-${day.value}`}
              checked={daysOfWeek.includes(day.value)}
              onCheckedChange={() => onToggleDay(day.value)}
            />
            <label htmlFor={`day-${day.value}`} className="cursor-pointer text-sm">
              {day.label.slice(0, 3)}
            </label>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Monthly Day Field ── */

function MonthlyDayField({
  dayOfMonth,
  onDayOfMonthChange,
}: {
  dayOfMonth: number
  onDayOfMonthChange: (v: number) => void
}) {
  return (
    <div className="space-y-2">
      <Label className="text-muted-copy">Day of Month</Label>
      <Input
        type="number" min={1} max={31} value={dayOfMonth}
        onChange={(e) => onDayOfMonthChange(Number(e.target.value))}
        className="brand-focus bg-field border-line text-ink"
      />
    </div>
  )
}

/* ── Cron Expression Field ── */

function CronExpressionField({
  cronspec,
  onCronspecChange,
}: {
  cronspec: string
  onCronspecChange: (v: string) => void
}) {
  return (
    <div className="space-y-2">
      <Label className="text-muted-copy">Cron Expression</Label>
      <Input
        value={cronspec}
        onChange={(e) => onCronspecChange(e.target.value)}
        placeholder="0 9 * * *"
        className="brand-focus bg-field border-line text-ink"
      />
      <p className="text-subtle-copy text-xs">
        Format: minute hour day-of-month month day-of-week
      </p>
    </div>
  )
}

/* ── Max Runs Field ── */

function MaxRunsField({
  maxRunsPerDay,
  onMaxRunsChange,
}: {
  maxRunsPerDay: number | undefined
  onMaxRunsChange: (v: number | undefined) => void
}) {
  return (
    <div className="space-y-2">
      <Label className="text-muted-copy">Max Runs Per Day (optional)</Label>
      <Input
        type="number" min={0}
        value={maxRunsPerDay ?? ''}
        onChange={(e) => onMaxRunsChange(e.target.value ? Number(e.target.value) : undefined)}
        placeholder="Unlimited"
        className="brand-focus bg-field border-line text-ink"
      />
      <p className="text-subtle-copy text-xs">Leave empty for unlimited runs</p>
    </div>
  )
}

/* ── Schedule form state hook ── */

function useScheduleFormState(workflow: Workflow | null) {
  const config = (workflow?.scheduleConfig || {}) as ScheduleConfig
  const initialTimezone = workflow?.timezone ?? 'UTC'
  const initialLocal = utcToLocal(config.hourUTC ?? 9, config.minuteUTC ?? 0, initialTimezone)

  const [scheduleType, setScheduleType] = useState<ScheduleType>(
    (workflow?.scheduleType as ScheduleType) || 'daily',
  )
  const [intervalMinutes, setIntervalMinutes] = useState(
    Math.round((config.intervalMs || 3600000) / 60000),
  )
  const [hourUTC, setHourUTC] = useState(initialLocal.hour)
  const [minuteUTC, setMinuteUTC] = useState(initialLocal.minute)
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(config.daysOfWeek ?? [1, 2, 3, 4, 5])
  const [dayOfMonth, setDayOfMonth] = useState(config.dayOfMonth ?? 1)
  const [cronspec, setCronspec] = useState(config.cronspec ?? '0 9 * * *')
  const [maxRunsPerDay, setMaxRunsPerDay] = useState<number | undefined>(workflow?.maxRunsPerDay)
  const [timezone, setTimezone] = useState(initialTimezone)

  const toggleDay = (day: number) => {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort(),
    )
  }

  return {
    scheduleType, setScheduleType,
    intervalMinutes, setIntervalMinutes,
    hourUTC, setHourUTC, minuteUTC, setMinuteUTC,
    daysOfWeek, toggleDay,
    dayOfMonth, setDayOfMonth,
    cronspec, setCronspec,
    maxRunsPerDay, setMaxRunsPerDay,
    timezone, setTimezone,
  }
}

/* ── Build schedule config for submission ── */

function buildSchedulePayload(
  form: ReturnType<typeof useScheduleFormState>,
) {
  const scheduleConfig: ScheduleConfig = {}
  const utc = localToUTC(form.hourUTC, form.minuteUTC, form.timezone)

  switch (form.scheduleType) {
    case 'interval':
      scheduleConfig.intervalMs = form.intervalMinutes * 60000
      break
    case 'daily':
      scheduleConfig.hourUTC = utc.hourUTC
      scheduleConfig.minuteUTC = utc.minuteUTC
      break
    case 'weekly':
      scheduleConfig.hourUTC = utc.hourUTC
      scheduleConfig.minuteUTC = utc.minuteUTC
      scheduleConfig.daysOfWeek = form.daysOfWeek
      break
    case 'monthly':
      scheduleConfig.hourUTC = utc.hourUTC
      scheduleConfig.minuteUTC = utc.minuteUTC
      scheduleConfig.dayOfMonth = form.dayOfMonth
      break
    case 'cron':
      scheduleConfig.cronspec = form.cronspec
      break
  }

  return {
    scheduleType: form.scheduleType,
    scheduleConfig,
    maxRunsPerDay: form.maxRunsPerDay && form.maxRunsPerDay > 0 ? form.maxRunsPerDay : undefined,
    timezone: form.timezone !== 'UTC' ? form.timezone : undefined,
  }
}

/* ── Conditional schedule fields ── */

function ScheduleFormFields({ form }: { form: ReturnType<typeof useScheduleFormState> }) {
  const showTimeFields =
    form.scheduleType === 'daily' || form.scheduleType === 'weekly' || form.scheduleType === 'monthly'

  return (
    <>
      {form.scheduleType === 'interval' && (
        <IntervalFields intervalMinutes={form.intervalMinutes} onIntervalChange={form.setIntervalMinutes} />
      )}
      {showTimeFields && (
        <TimeFields
          timezone={form.timezone} hourUTC={form.hourUTC} minuteUTC={form.minuteUTC}
          onTimezoneChange={form.setTimezone} onHourChange={form.setHourUTC} onMinuteChange={form.setMinuteUTC}
        />
      )}
      {form.scheduleType === 'weekly' && (
        <WeeklyDaysField daysOfWeek={form.daysOfWeek} onToggleDay={form.toggleDay} />
      )}
      {form.scheduleType === 'monthly' && (
        <MonthlyDayField dayOfMonth={form.dayOfMonth} onDayOfMonthChange={form.setDayOfMonth} />
      )}
      {form.scheduleType === 'cron' && (
        <CronExpressionField cronspec={form.cronspec} onCronspecChange={form.setCronspec} />
      )}
      <MaxRunsField maxRunsPerDay={form.maxRunsPerDay} onMaxRunsChange={form.setMaxRunsPerDay} />
    </>
  )
}

/* ── Inner Dialog ── */

function ScheduleDialogInner({
  open,
  onOpenChange,
  workflow,
  saving,
  onSave,
}: ScheduleDialogProps) {
  const form = useScheduleFormState(workflow)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(buildSchedulePayload(form))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-panel border-line text-ink border sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-ink">Schedule Settings</DialogTitle>
          <DialogDescription className="text-muted-copy">
            Configure when this workflow should run automatically.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <ScheduleTypeField scheduleType={form.scheduleType} onScheduleTypeChange={form.setScheduleType} />
          <ScheduleFormFields form={form} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving} className="brand-button">
              {saving ? 'Saving...' : 'Save Schedule'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
