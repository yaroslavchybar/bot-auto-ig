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
      {/* Ungrouped inputs — flat vertical stack */}
      {ungrouped.map((input) => (
        <InputField
          key={input.name}
          input={input}
          value={config[input.name]}
          onChange={(value) => onChange(input.name, value)}
          config={config}
        />
      ))}

      {/* Grouped inputs — section dividers */}
      {Object.entries(groups).map(([groupName, groupInputs]) => {
        const isInlinePair =
          groupInputs.length === 2 &&
          groupInputs.every((i) => i.type === 'number')

        return (
          <div key={groupName} className="pt-1">
            {/* Section divider + label */}
            <div className="border-line-soft mb-3 flex items-center gap-2 border-t pt-3">
              <span className="text-subtle-copy font-mono text-[10px] font-medium tracking-[0.18em] uppercase">
                {groupName}
              </span>
            </div>

            {/* Inputs: inline pair or vertical stack */}
            {isInlinePair ? (
              <div className="flex gap-3">
                {groupInputs.map((input) => (
                  <div key={input.name} className="flex-1">
                    <InputField
                      input={input}
                      value={config[input.name]}
                      onChange={(value) => onChange(input.name, value)}
                      compact
                      config={config}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {groupInputs.map((input) => (
                  <InputField
                    key={input.name}
                    input={input}
                    value={config[input.name]}
                    onChange={(value) => onChange(input.name, value)}
                    config={config}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
