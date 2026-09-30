import type { ActivityInput } from '@/features/automations/activities/types'
import { lazy, Suspense } from 'react'

const TypeScriptCodeField = lazy(() =>
  import('../TypeScriptCodeField').then((module) => ({ default: module.TypeScriptCodeField })),
)

interface CodeInputProps {
  input: ActivityInput
  value: unknown
  onChange: (value: unknown) => void
}

export function CodeInput({ input, value, onChange }: CodeInputProps) {
  return (
    <Suspense
      fallback={
        <p role="status" className="py-2 text-xs text-muted-copy">
          Loading editor…
        </p>
      }
    >
      <TypeScriptCodeField input={input} value={value} onChange={onChange} />
    </Suspense>
  )
}
