import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ActivityInput, ActivityInputOption } from '@/features/automations/activities/types'

interface SelectInputProps {
  input: ActivityInput
  value: unknown
  onChange: (value: unknown) => void
}

export function SelectInput({ input, value, onChange }: SelectInputProps) {
  const displayValue = value ?? input.default ?? ''

  return (
    <div className="flex flex-col space-y-1.5">
      <Label htmlFor={input.name} className="text-[13px] font-medium text-copy">
        {input.label}
        {input.required && <span className="ml-1 text-status-danger">*</span>}
      </Label>
      <Select value={String(displayValue)} onValueChange={(v) => onChange(v)}>
        <SelectTrigger className="h-8 rounded-lg border-line-soft bg-field-alt text-[13px] focus:ring-2 focus:ring-offset-0">
          <SelectValue placeholder={input.placeholder || 'Select...'} />
        </SelectTrigger>
        <SelectContent className="text-sm">
          {input.options?.map((opt: ActivityInputOption) => (
            <SelectItem key={opt.value} value={opt.value} className="text-sm">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {input.helpText && (
        <p className="text-[11px] leading-snug text-subtle-copy">{input.helpText}</p>
      )}
    </div>
  )
}
