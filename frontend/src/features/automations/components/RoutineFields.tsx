import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

// Optional bounds for a numeric input. Missing bounds are not enforced.
export type Limits = { min?: number; max?: number; step?: number }

// Titled card that holds related settings in two columns on wider screens.
// Collapsible groups show a toggle header and start closed unless defaultOpen is set.
export function SettingsGroup({
  title,
  collapsible = false,
  defaultOpen = true,
  children,
}: {
  title: string
  collapsible?: boolean
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()
  return (
    <section className="space-y-3">
      {collapsible ? (
        <h3 className="text-sm font-semibold text-ink">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? bodyId : undefined}
            onClick={() => setOpen((value) => !value)}
            className="flex w-full items-center justify-between gap-2 rounded-md brand-focus text-left"
          >
            {title}
            <ChevronDown
              className={cn('h-4 w-4 text-subtle-copy transition-transform', open && 'rotate-180')}
            />
          </button>
        </h3>
      ) : (
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
      )}
      {open && (
        <div
          id={bodyId}
          className="grid gap-x-4 gap-y-5 rounded-xl border border-line-soft bg-panel p-4 sm:grid-cols-2"
        >
          {children}
        </div>
      )}
    </section>
  )
}

// Label above one control. Wide fields span both columns of a group.
export function Field({
  id,
  label,
  action,
  wide,
  children,
}: {
  id: string
  label: string
  action?: ReactNode
  wide?: boolean
  children: ReactNode
}) {
  return (
    <div className={cn('grid content-start gap-1.5', wide && 'sm:col-span-2')}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-[13px] font-medium text-copy">
          {label}
        </Label>
        {action}
      </div>
      {children}
    </div>
  )
}

// True when a value is empty or outside its bounds.
function outside(value: number, { min, max }: Limits) {
  return (
    Number.isNaN(value) || (min !== undefined && value < min) || (max !== undefined && value > max)
  )
}

// Number input with an optional unit suffix. Turns red when the value is invalid.
function UnitInput({
  id,
  label,
  value,
  unit,
  limits,
  invalid,
  onChange,
}: {
  id: string
  label: string
  value: number
  unit?: string
  limits: Limits
  invalid: boolean
  onChange: (value: number) => void
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <Input
        id={id}
        aria-label={label}
        type="number"
        min={limits.min}
        max={limits.max}
        step={limits.step}
        value={Number.isNaN(value) ? '' : value}
        aria-invalid={invalid || undefined}
        onChange={(event) =>
          onChange(event.target.value === '' ? Number.NaN : Number(event.target.value))
        }
        className={cn(
          'h-9 brand-focus border-line bg-field pr-12 text-ink tabular-nums',
          invalid && 'border-status-danger-border',
        )}
      />
      {unit && (
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-subtle-copy">
          {unit}
        </span>
      )}
    </div>
  )
}

// One numeric setting with an optional unit.
export function NumberField({
  id,
  label,
  value,
  unit,
  limits = {},
  onChange,
}: {
  id: string
  label: string
  value: number
  unit?: string
  limits?: Limits
  onChange: (value: number) => void
}) {
  return (
    <Field id={id} label={label}>
      <UnitInput
        id={id}
        label={label}
        value={value}
        unit={unit}
        limits={limits}
        invalid={outside(value, limits)}
        onChange={onChange}
      />
    </Field>
  )
}

// Min and max inputs side by side. Both turn red when min is above max.
export function RangeField({
  id,
  label,
  unit,
  limits = {},
  minValue,
  maxValue,
  onChange,
  wide,
}: {
  id: string
  label: string
  unit?: string
  limits?: Limits
  minValue: number
  maxValue: number
  onChange: (min: number, max: number) => void
  wide?: boolean
}) {
  const reversed = minValue > maxValue
  return (
    <Field id={`${id}-min`} label={label} wide={wide}>
      <div className="flex items-center gap-2">
        <UnitInput
          id={`${id}-min`}
          label={`${label} minimum`}
          value={minValue}
          unit={unit}
          limits={limits}
          invalid={outside(minValue, limits) || reversed}
          onChange={(next) => onChange(next, maxValue)}
        />
        <span className="text-subtle-copy">–</span>
        <UnitInput
          id={`${id}-max`}
          label={`${label} maximum`}
          value={maxValue}
          unit={unit}
          limits={limits}
          invalid={outside(maxValue, limits) || reversed}
          onChange={(next) => onChange(minValue, next)}
        />
      </div>
    </Field>
  )
}

// Chance from 0 to 100 shown as a slider with its current value.
export function PercentField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <Field
      id={id}
      label={label}
      action={<span className="text-xs text-subtle-copy tabular-nums">{value}%</span>}
    >
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer accent-status-info"
      />
    </Field>
  )
}

// On/off setting shown as a full row. Clicking anywhere on the row toggles it.
export function ToggleRow({
  label,
  checked,
  onChange,
  wide,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  wide?: boolean
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-line-soft px-3 py-2.5',
        wide && 'sm:col-span-2',
      )}
    >
      <span className="text-[13px] font-medium text-copy">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} className="shrink-0 brand-switch" />
    </label>
  )
}
