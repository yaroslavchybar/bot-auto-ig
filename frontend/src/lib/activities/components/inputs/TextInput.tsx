import { Input as BaseInput } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ActivityInput } from '../../types'

interface TextInputProps {
    input: ActivityInput
    value: unknown
    onChange: (value: unknown) => void
}

export function TextInput({ input, value, onChange }: TextInputProps) {
    const displayValue = value ?? input.default ?? ''

    return (
        <div className="space-y-1 flex flex-col">
            <Label htmlFor={input.name} className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
                {input.label}
                {input.required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <BaseInput
                id={input.name}
                type="text"
                value={displayValue as string}
                onChange={(e) => onChange(e.target.value)}
                placeholder={input.placeholder}
                className="h-7 rounded-[2px] text-[11px] focus-visible:ring-1 focus-visible:ring-offset-0 border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900"
            />
            {input.helpText && (
                <p className="text-[10px] text-neutral-500 dark:text-neutral-400 leading-tight">{input.helpText}</p>
            )}
        </div>
    )
}
