import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import type { ActivityInput } from '@/features/workflows/activities/types'

function normalizeValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
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

export function StringListInput({
  input,
  value,
  onChange,
}: StringListInputProps) {
  const displayValue = normalizeValues(value ?? input.default).join('\n')

  return (
    <div className="flex flex-col space-y-1.5">
      <Label
        htmlFor={input.name}
        className="text-copy text-[11px] font-medium"
      >
        {input.label}
        {input.required && <span className="text-status-danger ml-1">*</span>}
      </Label>
      <Textarea
        id={input.name}
        value={displayValue}
        onChange={(event) => onChange(normalizeValues(event.target.value))}
        placeholder={input.placeholder}
        className="border-line-soft bg-field-alt min-h-[140px] rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-0"
      />
      {input.helpText && (
        <p className="text-subtle-copy text-[10px] leading-tight">
          {input.helpText}
        </p>
      )}
    </div>
  )
}
