import { Input as BaseInput } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ActivityInput } from '@/features/workflows/activities/types'

interface TextInputProps {
  input: ActivityInput
  value: unknown
  onChange: (value: unknown) => void
}

export function TextInput({ input, value, onChange }: TextInputProps) {
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
      <BaseInput
        id={input.name}
        type="text"
        value={displayValue as string}
        onChange={(e) => onChange(e.target.value)}
        placeholder={input.placeholder}
        className="border-line-soft bg-field-alt h-9 rounded-lg px-3 text-sm focus-visible:ring-2 focus-visible:ring-offset-0"
      />
      {input.helpText && (
        <p className="text-subtle-copy text-[10px] leading-tight">
          {input.helpText}
        </p>
      )}
    </div>
  )
}



