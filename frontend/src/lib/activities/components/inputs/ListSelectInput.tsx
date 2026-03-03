import { useQuery } from 'convex/react'
import { api } from '../../../../../../convex/_generated/api'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import type { ActivityInput } from '../../types'

interface ListSelectInputProps {
    input: ActivityInput
    value: unknown
    onChange: (value: string[]) => void
}

export function ListSelectInput({ input, value, onChange }: ListSelectInputProps) {
    const lists = useQuery(api.lists.list, {})
    const selectedLists = (value as string[]) || []

    const toggleList = (listId: string) => {
        if (selectedLists.includes(listId)) {
            onChange(selectedLists.filter((id) => id !== listId))
        } else {
            onChange([...selectedLists, listId])
        }
    }

    return (
        <div className="space-y-1 mt-2">
            <Label className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
                {input.label}
            </Label>
            {input.helpText && (
                <p className="text-[10px] text-neutral-500 dark:text-neutral-400 leading-tight">
                    {input.helpText}
                </p>
            )}
            <div className="border border-neutral-300 dark:border-neutral-700 rounded-[3px] p-2 space-y-1.5 max-h-40 overflow-auto bg-neutral-50 dark:bg-neutral-900/50 mt-1">
                {!lists ? (
                    <p className="text-[10px] text-neutral-500 text-center py-2">Loading lists...</p>
                ) : lists.length === 0 ? (
                    <p className="text-[10px] text-neutral-500 text-center py-2">No lists available</p>
                ) : (
                    lists.map((list: any) => (
                        <div key={list._id} className="flex items-center space-x-2 border border-transparent rounded-[2px] px-1 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800/60">
                            <Checkbox
                                id={`list-${list._id}`}
                                checked={selectedLists.includes(list._id)}
                                onCheckedChange={() => toggleList(list._id)}
                                className="h-3.5 w-3.5 rounded-[2px]"
                            />
                            <Label
                                htmlFor={`list-${list._id}`}
                                className="text-[11px] cursor-pointer flex-1 text-neutral-700 dark:text-neutral-300"
                            >
                                {list.name}
                            </Label>
                        </div>
                    ))
                )}
            </div>
            {selectedLists.length > 0 && (
                <p className="text-[9px] uppercase tracking-wide text-neutral-500 font-mono mt-1 text-right">
                    {selectedLists.length} list(s) selected
                </p>
            )}
        </div>
    )
}
