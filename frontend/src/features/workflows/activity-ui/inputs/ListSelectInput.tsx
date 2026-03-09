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
    <div className="mt-2 space-y-1">
      <Label className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
        {input.label}
      </Label>
      {input.helpText && (
        <p className="text-[10px] leading-tight text-neutral-500 dark:text-neutral-400">
          {input.helpText}
        </p>
      )}
      <div className="mt-1 max-h-40 space-y-1.5 overflow-auto rounded-[3px] border border-neutral-300 bg-neutral-50 p-2 dark:border-neutral-700 dark:bg-neutral-900/50">
        {!lists ? (
          <p className="py-2 text-center text-[10px] text-neutral-500">
            Loading lists...
          </p>
        ) : availableLists.length === 0 ? (
          <p className="py-2 text-center text-[10px] text-neutral-500">
            No lists available
          </p>
        ) : (
          availableLists.map((list) => (
            <div
              key={list._id}
              className="flex items-center space-x-2 rounded-[2px] border border-transparent px-1 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
            >
              <Checkbox
                id={`list-${list._id}`}
                checked={selectedLists.includes(list._id)}
                onCheckedChange={() => toggleList(list._id)}
                className="h-3.5 w-3.5 rounded-[2px]"
              />
              <Label
                htmlFor={`list-${list._id}`}
                className="flex-1 cursor-pointer text-[11px] text-neutral-700 dark:text-neutral-300"
              >
                {list.name}
              </Label>
            </div>
          ))
        )}
      </div>
      {selectedLists.length > 0 && (
        <p className="mt-1 text-right font-mono text-[9px] tracking-wide text-neutral-500 uppercase">
          {selectedLists.length} list(s) selected
        </p>
      )}
    </div>
  )
}



