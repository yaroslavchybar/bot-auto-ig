import { Input as BaseInput } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ActivityInput } from '../../types'

interface NumberInputProps {
    input: ActivityInput
    value: unknown
    onChange: (value: unknown) => void
    compact?: boolean
}

export function NumberInput({ input, value, onChange, compact }: NumberInputProps) {
    const displayValue = value ?? input.default ?? ''

    return (
        <div className="space-y-1 flex flex-col">
            <Label htmlFor={input.name} className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300 flex justify-between">
                <span>
                    {input.label}
                    {input.required && <span className="text-red-500 ml-1">*</span>}
                </span>
                {input.unit && !compact && <span className="text-[10px] text-neutral-500 font-mono">{input.unit}</span>}
            </Label>
            <div className="flex items-center gap-1.5">
                <BaseInput
                    id={input.name}
                    type="number"
                    min={input.min}
                    max={input.max}
                    step={input.step}
                    value={displayValue as number}
                    onChange={(e) => onChange(Number(e.target.value))}
                    placeholder={input.placeholder}
                    className="h-6 rounded-[2px] text-[11px] focus-visible:ring-1 focus-visible:ring-offset-0 border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900"
                />
                {compact && input.unit && (
                    <span className="text-[10px] text-neutral-500 font-mono w-6 shrink-0">{input.unit}</span>
                )}
            </div>
            {input.helpText && (
                <p className="text-[10px] text-neutral-500 dark:text-neutral-400 leading-tight">{input.helpText}</p>
            )}
        </div>
    )
}
