import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ActivityInput, ActivityInputOption } from '@/features/workflows/activities/types'

interface SelectInputProps {
  input: ActivityInput
  value: unknown
  onChange: (value: unknown) => void
}

export function SelectInput({ input, value, onChange }: SelectInputProps) {
  const displayValue = value ?? input.default ?? ''

  return (
    <div className="flex flex-col space-y-1.5">
      <Label
        htmlFor={input.name}
        className="text-copy text-[11px] font-medium"
      >
        {input.label}
        {input.required && <span className="text-status-danger ml-1">*</span>}
      </Label>
      <Select value={String(displayValue)} onValueChange={(v) => onChange(v)}>
        <SelectTrigger className="border-line-soft bg-field-alt h-9 rounded-lg text-sm focus:ring-2 focus:ring-offset-0">
          <SelectValue placeholder={input.placeholder || 'Select...'} />
        </SelectTrigger>
        <SelectContent className="text-sm">
          {input.options?.map((opt: ActivityInputOption) => (
            <SelectItem
              key={opt.value}
              value={opt.value}
              className="text-sm"
            >
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {input.helpText && (
        <p className="text-subtle-copy text-[10px] leading-tight">
          {input.helpText}
        </p>
      )}
    </div>
  )
}



