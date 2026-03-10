import { useQuery } from 'convex/react'
import { api } from '../../../../../../convex/_generated/api'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import type { ActivityInput } from '@/features/workflows/activities/types'

type SelectableList = {
  _id: string
  name: string
}

interface ListSelectInputProps {
  input: ActivityInput
  value: unknown
  onChange: (value: string[]) => void
}

export function ListSelectInput({
  input,
  value,
  onChange,
}: ListSelectInputProps) {
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
    <div className="mt-2 space-y-1.5">
      <Label className="text-copy text-[11px] font-medium">
        {input.label}
      </Label>
      {input.helpText && (
        <p className="text-subtle-copy text-[10px] leading-tight">
          {input.helpText}
        </p>
      )}
      <div className="border-line-soft bg-panel-subtle/80 mt-1 max-h-40 space-y-1.5 overflow-auto rounded-xl border p-3">
        {!lists ? (
          <p className="text-subtle-copy py-2 text-center text-[10px]">
            Loading lists...
          </p>
        ) : availableLists.length === 0 ? (
          <p className="text-subtle-copy py-2 text-center text-[10px]">
            No lists available
          </p>
        ) : (
          availableLists.map((list) => (
            <div
              key={list._id}
              className="hover:bg-panel-hover/70 flex items-center space-x-2 rounded-lg border border-transparent px-2 py-1 transition-colors"
            >
              <Checkbox
                id={`list-${list._id}`}
                checked={selectedLists.includes(list._id)}
                onCheckedChange={() => toggleList(list._id)}
                className="h-3.5 w-3.5"
              />
              <Label
                htmlFor={`list-${list._id}`}
                className="text-copy flex-1 cursor-pointer text-[11px]"
              >
                {list.name}
              </Label>
            </div>
          ))
        )}
      </div>
      {selectedLists.length > 0 && (
        <p className="text-subtle-copy mt-1 text-right font-mono text-[9px] tracking-wide uppercase">
          {selectedLists.length} list(s) selected
        </p>
      )}
    </div>
  )
}



