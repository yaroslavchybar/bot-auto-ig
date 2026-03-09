import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  MoreHorizontal,
  Pencil,
  Trash2,
  RefreshCw,
  List as ListIcon,
} from 'lucide-react'
import type { List } from '../types'
import { cn } from '@/lib/utils'

interface ListsListProps {
  lists: List[]
  loading: boolean
  onEdit: (list: List) => void
  onDelete: (list: List) => void
}

export function ListsList({
  lists,
  loading,
  onEdit,
  onDelete,
}: ListsListProps) {
  const isMobile = useIsMobile()

  if (loading && lists.length === 0) {
    return (
      <div className="text-muted-foreground flex animate-pulse items-center justify-center gap-2 p-12 text-center text-sm">
        <RefreshCw className="h-4 w-4 shrink-0 animate-spin" /> Loading lists...
      </div>
    )
  }

  if (lists.length === 0) {
    return (
      <div className="border-line-soft bg-panel-subtle flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 text-center">
        <ListIcon className="text-subtle-copy mb-4 h-10 w-10" />
        <h3 className="text-ink text-lg font-medium">No lists</h3>
        <p className="text-subtle-copy mt-1 text-sm">
          Create a new list to organize your profiles.
        </p>
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
              'bg-panel-strong rounded-2xl border p-4 shadow-xs transition-colors',
              'border-line hover:border-line-strong',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-subtle-copy text-[11px] tracking-[0.18em] uppercase">
                  List #{idx + 1}
                </div>
                <h3 className="text-inverse mt-1 truncate text-base font-semibold">
                  {list.name}
                </h3>
                <p className="text-subtle-copy mt-2 truncate font-mono text-[11px]">
                  {list.id}
                </p>
              </div>
              <div onClick={(event) => event.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className="text-muted-copy hover:bg-panel-muted h-8 w-8 p-0 hover:text-ink"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="panel-dropdown w-48"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <DropdownMenuLabel className="text-muted-copy">
                      Actions
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      onClick={() => onEdit(list)}
                      className="hover:bg-panel-hover focus:bg-panel-hover cursor-pointer"
                    >
                      <Pencil className="mr-2 h-4 w-4" /> Edit List
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onDelete(list)}
                      className="text-status-danger focus:text-status-danger focus:bg-status-danger-soft hover:bg-status-danger-soft cursor-pointer"
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Delete List
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="border-line mt-4 border-t pt-3">
              <Button
                variant="ghost"
                size="sm"
                className="border-line text-ink hover:bg-panel-muted h-9 rounded-full border px-3"
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
    <div className="bg-panel-subtle border-line-soft overflow-hidden rounded-2xl border shadow-xs backdrop-blur-xs">
      <Table>
        <TableHeader>
          <TableRow className="border-line-soft border-b bg-transparent hover:bg-transparent">
            <TableHead className="text-muted-copy h-12 w-[80px] pl-4 font-medium">
              No.
            </TableHead>
            <TableHead className="text-muted-copy h-12 w-full font-medium">
              Name
            </TableHead>
            <TableHead className="text-muted-copy h-12 w-[180px] font-medium">
              List ID
            </TableHead>
            <TableHead className="text-muted-copy h-12 w-[140px] pr-4 text-right font-medium">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lists.map((list, idx) => (
            <TableRow
              key={list.id}
              className={cn(
                'group border-line-soft h-14 border-b transition-colors hover:bg-panel-subtle',
              )}
            >
              <TableCell className="pl-4">
                <span className="text-subtle-copy font-mono text-sm">
                  {idx + 1}
                </span>
              </TableCell>

              <TableCell className="font-medium">
                <span className="text-ink">{list.name}</span>
              </TableCell>

              <TableCell>
                <span className="text-subtle-copy truncate font-mono text-[10px]">
                  {list.id}
                </span>
              </TableCell>

              <TableCell className="pr-4 text-right">
                <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-copy hover:bg-panel-muted h-8 w-8 hover:text-ink"
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
                      <Button
                        variant="ghost"
                        className="text-muted-copy hover:bg-panel-muted h-8 w-8 p-0 hover:text-ink"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="sr-only">Open menu</span>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="panel-dropdown w-48"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <DropdownMenuLabel className="text-muted-copy">
                        Actions
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() => onEdit(list)}
                        className="hover:bg-panel-hover focus:bg-panel-hover cursor-pointer"
                      >
                        <Pencil className="mr-2 h-4 w-4" /> Edit List
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onDelete(list)}
                        className="text-status-danger focus:text-status-danger focus:bg-status-danger-soft hover:bg-status-danger-soft cursor-pointer"
                      >
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



