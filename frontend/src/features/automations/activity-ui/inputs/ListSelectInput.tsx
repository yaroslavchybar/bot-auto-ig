import { useQuery } from 'convex/react'
import { api } from '../../../../../../convex/_generated/api'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import type { ActivityInput } from '@/features/automations/activities/types'

type SelectableList = {
  _id: string
  name: string
}

interface ListSelectInputProps {
  input: ActivityInput
  value: unknown
  onChange: (value: string[]) => void
}

export function ListSelectInput({ input, value, onChange }: ListSelectInputProps) {
  const lists = useQuery(api.lists.list, {})
  const selectedLists = (value as string[]) || []
  const availableLists: SelectableList[] = Array.isArray(lists)
    ? lists.map((list) => ({
        _id: String(list._id),
        name: list.name,
      }))
    : []

  const toggleList = (listId: string) => {
    if (selectedLists.includes(listId)) {
      onChange(selectedLists.filter((id) => id !== listId))
    } else {
      onChange([...selectedLists, listId])
    }
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] font-medium text-copy">{input.label}</Label>
      {input.helpText && (
        <p className="text-[10px] leading-tight text-subtle-copy">{input.helpText}</p>
      )}
      <div className="mt-1 max-h-40 space-y-0.5 overflow-auto rounded-lg bg-field-alt p-2">
        {!lists ? (
          <p className="py-2 text-center text-[10px] text-subtle-copy">Loading lists...</p>
        ) : availableLists.length === 0 ? (
          <p className="py-2 text-center text-[10px] text-subtle-copy">No lists available</p>
        ) : (
          availableLists.map((list) => (
            <div
              key={list._id}
              className="flex items-center space-x-2 rounded-md px-2 py-1.5 hover:bg-panel-hover/70"
            >
              <Checkbox
                id={`list-${list._id}`}
                checked={selectedLists.includes(list._id)}
                onCheckedChange={() => toggleList(list._id)}
                className="h-3.5 w-3.5 brand-checkbox"
              />
              <Label
                htmlFor={`list-${list._id}`}
                className="flex-1 cursor-pointer text-[11px] text-copy"
              >
                {list.name}
              </Label>
            </div>
          ))
        )}
      </div>
      {selectedLists.length > 0 && (
        <p className="mt-1 text-right font-mono text-[9px] tracking-wide text-subtle-copy uppercase">
          {selectedLists.length} list(s) selected
        </p>
      )}
    </div>
  )
}
