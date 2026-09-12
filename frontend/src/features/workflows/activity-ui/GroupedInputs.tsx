import type { ActivityInput } from '@/features/workflows/activities/types'
import { InputField } from './InputField'
import { MinMaxField } from './MinMaxField'

interface GroupedInputsProps {
  inputs: ActivityInput[]
  config: Record<string, unknown>
  onChange: (name: string, value: unknown) => void
}

interface Section {
  name: string | null
  inputs: ActivityInput[]
}

/** Split inputs into sections, preserving definition order. */
function buildSections(inputs: ActivityInput[]): Section[] {
  const order: Section[] = []
  const byName = new Map<string, Section>()

  const getOrCreate = (name: string | null): Section => {
    if (name === null) {
      let section = order.find((s) => s.name === null)
      if (!section) {
        section = { name: null, inputs: [] }
        order.push(section)
      }
      return section
    }
    let section = byName.get(name)
    if (!section) {
      section = { name, inputs: [] }
      byName.set(name, section)
      order.push(section)
    }
    return section
  }

  for (const input of inputs) {
    getOrCreate(input.group ?? null).inputs.push(input)
  }
  return order
}

/** A section with exactly two min/max numbers renders as one row. */
function isMinMaxPair(inputs: ActivityInput[]): boolean {
  if (inputs.length !== 2 || inputs.some((i) => i.type !== 'number')) {
    return false
  }
  const [a, b] = inputs.map((i) => `${i.name} ${i.label}`.toLowerCase())
  return (
    (a.includes('min') && b.includes('max')) ||
    (a.includes('max') && b.includes('min'))
  )
}

function orderedMinMax(inputs: ActivityInput[]): [ActivityInput, ActivityInput] {
  const [first, second] = inputs
  return `${first.name} ${first.label}`.toLowerCase().includes('min')
    ? [first, second]
    : [second, first]
}

function SectionBody({
  section,
  config,
  onChange,
}: {
  section: Section
  config: Record<string, unknown>
  onChange: (name: string, value: unknown) => void
}) {
  if (isMinMaxPair(section.inputs)) {
    const [minInput, maxInput] = orderedMinMax(section.inputs)
    return (
      <MinMaxField
        title={section.name ?? undefined}
        minInput={minInput}
        maxInput={maxInput}
        minValue={config[minInput.name]}
        maxValue={config[maxInput.name]}
        onChange={onChange}
      />
    )
  }

  return (
    <div className="space-y-4">
      {section.inputs.map((input) => (
        <InputField
          key={input.name}
          input={input}
          value={config[input.name]}
          onChange={(value) => onChange(input.name, value)}
          config={config}
        />
      ))}
    </div>
  )
}

export function GroupedInputs({
  inputs,
  config,
  onChange,
}: GroupedInputsProps) {
  const sections = buildSections(inputs)

  // Single flat section — no card chrome needed.
  if (sections.length === 1 && sections[0].name === null) {
    return <SectionBody section={sections[0]} config={config} onChange={onChange} />
  }

  return (
    <div className="space-y-4">
      {sections.map((section) =>
        section.name === null ? (
          <div key="general">
            <SectionBody section={section} config={config} onChange={onChange} />
          </div>
        ) : (
          <section key={section.name} className="space-y-1.5">
            <h4 className="text-subtle-copy font-mono text-[10px] font-medium tracking-[0.18em] uppercase">
              {section.name}
            </h4>
            <div className="border-line-soft bg-panel-subtle/40 rounded-xl border p-3">
              <SectionBody section={section} config={config} onChange={onChange} />
            </div>
          </section>
        ),
      )}
    </div>
  )
}
