import { Label } from '@/components/ui/label'
import type { ActivityInput } from '@/features/workflows/activities/types'
import { InputField } from './InputField'

interface GroupedInputsProps {
  inputs: ActivityInput[]
  config: Record<string, unknown>
  onChange: (name: string, value: unknown) => void
}

export function GroupedInputs({
  inputs,
  config,
  onChange,
}: GroupedInputsProps) {
  // Separate grouped and ungrouped inputs
  const groups: Record<string, ActivityInput[]> = {}
  const ungrouped: ActivityInput[] = []

  for (const input of inputs) {
    if (input.group) {
      if (!groups[input.group]) groups[input.group] = []
      groups[input.group].push(input)
    } else {
      ungrouped.push(input)
    }
  }

  return (
    <>
      {/* Ungrouped inputs first */}
      {ungrouped.map((input) => (
        <InputField
          key={input.name}
          input={input}
          value={config[input.name]}
          onChange={(value) => onChange(input.name, value)}
          config={config}
        />
      ))}

      {/* Grouped inputs */}
      {Object.entries(groups).map(([groupName, groupInputs]) => (
        <div
          key={groupName}
          className="border-line-soft bg-panel-subtle/80 mt-3 rounded-xl border p-3"
        >
          <Label className="text-muted-copy mb-3 block font-mono text-[10px] font-semibold tracking-[0.18em] uppercase">
            {groupName}
          </Label>
          <div className="grid grid-cols-2 gap-2">
            {groupInputs.map((input) => (
              <InputField
                key={input.name}
                input={input}
                value={config[input.name]}
                onChange={(value) => onChange(input.name, value)}
                compact
                config={config}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  )
}



