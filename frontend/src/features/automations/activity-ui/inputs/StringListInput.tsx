import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import type { ActivityInput } from '@/features/automations/activities/types'

function normalizeValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean)
  }

  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .flatMap((line) => line.split(','))
      .map((item) => item.trim())
      .filter(Boolean)
  }

  return []
}

interface StringListInputProps {
  input: ActivityInput
  value: unknown
  onChange: (value: unknown) => void
}

export function StringListInput({ input, value, onChange }: StringListInputProps) {
  const displayValue = normalizeValues(value ?? input.default).join('\n')

  return (
    <div className="flex flex-col space-y-1.5">
      <Label htmlFor={input.name} className="text-[11px] font-medium text-copy">
        {input.label}
        {input.required && <span className="ml-1 text-status-danger">*</span>}
      </Label>
      <Textarea
        id={input.name}
        value={displayValue}
        onChange={(event) => onChange(normalizeValues(event.target.value))}
        placeholder={input.placeholder}
        className="min-h-[140px] rounded-lg border-line-soft bg-field-alt px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-0"
      />
      {input.helpText && (
        <p className="text-[10px] leading-tight text-subtle-copy">{input.helpText}</p>
      )}
    </div>
  )
}
