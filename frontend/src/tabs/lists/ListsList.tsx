import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { useIsMobile } from '@/hooks/use-mobile'
import { MoreHorizontal, Pencil, Trash2, RefreshCw, List as ListIcon } from "lucide-react"
import type { List } from './types'
import { cn } from "@/lib/utils"

interface ListsListProps {
  lists: List[]
  selectedId: string | null
  loading: boolean
  onSelect: (list: List) => void
  onEdit: (list: List) => void
  onDelete: (list: List) => void
}

export function ListsList({ lists, selectedId, loading, onSelect, onEdit, onDelete }: ListsListProps) {
  const isMobile = useIsMobile()

  if (loading && lists.length === 0) {
    return <div className="p-12 text-center text-sm text-muted-foreground animate-pulse flex items-center justify-center gap-2"><RefreshCw className="h-4 w-4 animate-spin shrink-0" /> Loading lists...</div>
  }

  if (lists.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center border-2 border-dashed border-white/5 rounded-2xl bg-white/[0.01]">
        <ListIcon className="h-10 w-10 text-gray-500 mb-4" />
        <h3 className="text-lg font-medium text-gray-200">No lists</h3>
        <p className="text-sm text-gray-500 mt-1">Create a new list to organize your profiles.</p>
      </div>
    )
  }

  if (isMobile) {
    return (
      <div className="space-y-3">
        {lists.map((list, idx) => (
          <div
            key={list.id}
            className={cn(
              'rounded-2xl border bg-[#141414] p-4 shadow-xs transition-colors',
              selectedId === list.id ? 'border-orange-500/60 bg-white/[0.04]' : 'border-white/10 hover:border-white/20'
            )}
            onClick={() => onSelect(list)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">List #{idx + 1}</div>
                <h3 className="mt-1 truncate text-base font-semibold text-gray-100">{list.name}</h3>
                <p className="mt-2 truncate font-mono text-[11px] text-gray-500">{list.id}</p>
              </div>
              <div onClick={(event) => event.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-8 w-8 p-0 text-gray-400 hover:text-white hover:bg-white/5">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 bg-[#0f0f0f] border-white/10 text-gray-200" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuLabel className="text-gray-400">Actions</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => onEdit(list)} className="hover:bg-white/10 focus:bg-white/10 cursor-pointer">
                      <Pencil className="mr-2 h-4 w-4" /> Edit List
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onDelete(list)} className="text-red-400 focus:text-red-400 focus:bg-red-500/10 hover:bg-red-500/10 cursor-pointer">
                      <Trash2 className="mr-2 h-4 w-4" /> Delete List
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="mt-4 border-t border-white/10 pt-3">
              <Button
                variant="ghost"
                size="sm"
                className="h-9 rounded-full border border-white/10 px-3 text-gray-200 hover:bg-white/5"
                onClick={(event) => {
                  event.stopPropagation()
                  onEdit(list)
                }}
              >
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl backdrop-blur-xs shadow-xs overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-transparent hover:bg-transparent border-b border-white/[0.05]">
            <TableHead className="w-[80px] pl-4 text-gray-400 font-medium h-12">No.</TableHead>
            <TableHead className="w-full text-gray-400 font-medium h-12">Name</TableHead>
            <TableHead className="w-[180px] text-gray-400 font-medium h-12">List ID</TableHead>
            <TableHead className="w-[140px] text-right pr-4 text-gray-400 font-medium h-12">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lists.map((list, idx) => (
            <TableRow
              key={list.id}
              onClick={() => onSelect(list)}
              className={cn(
                "group cursor-pointer transition-colors h-14 border-b border-white/[0.05]",
                selectedId === list.id ? "bg-white/[0.04]" : "hover:bg-white/[0.02]"
              )}
            >
              <TableCell className="pl-4">
                <span className="text-sm text-gray-500 font-mono">{idx + 1}</span>
              </TableCell>

              <TableCell className="font-medium">
                <span className="text-gray-200">{list.name}</span>
              </TableCell>

              <TableCell>
                <span className="text-[10px] text-gray-500 font-mono truncate">
                  {list.id}
                </span>
              </TableCell>

              <TableCell className="text-right pr-4">
                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-gray-400 hover:text-white hover:bg-white/5"
                    onClick={(e) => {
                      e.stopPropagation()
                      onEdit(list)
                    }}
                    title="Edit List"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="h-8 w-8 p-0 text-gray-400 hover:text-white hover:bg-white/5" onClick={(e) => e.stopPropagation()}>
                        <span className="sr-only">Open menu</span>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 bg-[#0f0f0f] border-white/10 text-gray-200" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuLabel className="text-gray-400">Actions</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => onEdit(list)} className="hover:bg-white/10 focus:bg-white/10 cursor-pointer">
                        <Pencil className="mr-2 h-4 w-4" /> Edit List
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onDelete(list)} className="text-red-400 focus:text-red-400 focus:bg-red-500/10 hover:bg-red-500/10 cursor-pointer">
                        <Trash2 className="mr-2 h-4 w-4" /> Delete List
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
