import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import type { ActivityInput } from '../../types'

interface BooleanInputProps {
    input: ActivityInput
    value: unknown
    onChange: (value: unknown) => void
}

export function BooleanInput({ input, value, onChange }: BooleanInputProps) {
    const displayValue = value ?? input.default ?? ''

    return (
        <div className="space-y-1.5 border border-neutral-300 dark:border-neutral-700 rounded-[3px] p-2 bg-neutral-50/70 dark:bg-neutral-900/40">
            <div className="flex items-center space-x-2">
                <Checkbox
                    id={input.name}
                    checked={!!displayValue}
                    onCheckedChange={(checked) => onChange(!!checked)}
                    className="h-3.5 w-3.5 rounded-[2px]"
                />
                <Label htmlFor={input.name} className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300 cursor-pointer">
                    {input.label}
                    {input.required && <span className="text-red-500 ml-1">*</span>}
                </Label>
            </div>
            {input.helpText && (
                <p className="text-[10px] text-neutral-500 dark:text-neutral-400 pl-5 leading-tight">{input.helpText}</p>
            )}
        </div>
    )
}
