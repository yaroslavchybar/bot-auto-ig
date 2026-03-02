import { Pencil, Trash2, List as ListIcon, Hash } from "lucide-react"
import type { List } from './types'
import { DenseButton } from "@/components/ui/dense-button"
import { ScrollArea } from "@/components/ui/scroll-area"

interface ListsListProps {
  lists: List[]
  selectedId: string | null
  loading: boolean
  onSelect: (list: List) => void
  onEdit: (list: List) => void
  onDelete: (list: List) => void
}

export function ListsList({ lists, selectedId, loading, onSelect, onEdit, onDelete }: ListsListProps) {
  if (loading && lists.length === 0) {
    return <div className="flex items-center justify-center p-4 text-neutral-500 text-[11px] italic">Fetching lists...</div>
  }

  if (lists.length === 0) {
    return <div className="flex items-center justify-center p-4 text-neutral-500 text-[11px]">No matching records found. Create one to get started.</div>
  }

  return (
    <div className="flex flex-col h-full w-full">
      {/* Table Header Row */}
      <div className="flex items-center bg-neutral-100 dark:bg-neutral-800 border-b border-neutral-300 dark:border-neutral-700 text-[10px] uppercase font-semibold text-neutral-500 dark:text-neutral-400 shrink-0 select-none">
        {/* Name Column */}
        <div className="flex-1 w-0 min-w-[200px] border-r border-neutral-300 dark:border-neutral-700 px-2 py-1 flex items-center gap-1.5">
          <ListIcon className="w-3 h-3 text-neutral-400" />
          List Name
        </div>

        {/* ID Column */}
        <div className="w-[180px] shrink-0 border-r border-neutral-300 dark:border-neutral-700 px-2 py-1 flex items-center gap-1.5">
          <Hash className="w-3 h-3 text-neutral-400" />
          List ID
        </div>

        {/* Actions Column */}
        <div className="w-[140px] shrink-0 px-2 py-1 flex items-center justify-end">
          Actions
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0 bg-white dark:bg-[#121212] select-text">
        <div className="flex flex-col pb-4">
          {lists.map((list) => {
            const isSelected = selectedId === list.id

            return (
              <div
                key={list.id}
                onClick={() => onSelect(list)}
                className={`flex items-center border-b border-neutral-100 dark:border-neutral-800/60 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 cursor-pointer ${isSelected ? 'bg-blue-50/50 dark:bg-blue-900/20' : ''
                  }`}
              >
                {/* Name */}
                <div className={`flex-1 w-0 min-w-[200px] px-2 py-0.5 text-[11px] whitespace-nowrap overflow-hidden text-ellipsis border-r border-transparent ${isSelected ? 'text-blue-700 dark:text-blue-400 font-medium' : 'text-neutral-700 dark:text-neutral-300'}`}>
                  {list.name}
                </div>

                {/* ID Column */}
                <div className="w-[180px] shrink-0 px-2 py-0.5 text-[10px] text-neutral-500 dark:text-neutral-500 whitespace-nowrap overflow-hidden text-ellipsis border-r border-transparent font-mono">
                  {list.id}
                </div>

                {/* Actions Column */}
                <div className="w-[140px] shrink-0 px-2 py-0.5 flex items-center justify-end gap-1">
                  <DenseButton
                    onClick={(e) => { e.stopPropagation(); onEdit(list); }}
                    className="h-5 px-1.5 w-auto border-transparent shadow-none hover:border-neutral-300 dark:hover:border-neutral-600 bg-transparent text-neutral-600 dark:text-neutral-400 hover:text-blue-600 dark:hover:text-blue-400"
                  >
                    <Pencil className="h-3 w-3 mr-1" /> Edit
                  </DenseButton>
                  <DenseButton
                    onClick={(e) => { e.stopPropagation(); onDelete(list); }}
                    className="h-5 px-1.5 w-auto border-transparent shadow-none hover:border-neutral-300 dark:hover:border-neutral-600 bg-transparent text-neutral-600 dark:text-neutral-400 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
                  >
                    <Trash2 className="h-3 w-3 mr-1" /> Delete
                  </DenseButton>
                </div>
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
