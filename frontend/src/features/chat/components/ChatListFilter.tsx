import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export function ChatListFilter({
  value,
  lists,
  loading,
  onChange,
}: {
  value: string
  lists: { _id: string; name: string }[]
  loading: boolean
  onChange: (id: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={loading}>
      <SelectTrigger
        aria-label="Filter by scraped list"
        title={
          lists.find(({ _id }) => _id === value)?.name ??
          (value === 'unassigned' ? 'Unassigned' : 'All lists')
        }
        className={cn(
          'h-8 w-auto max-w-36 gap-1 rounded-full border-transparent px-3 text-xs font-semibold shadow-none [&>span]:truncate',
          value === 'all' ? 'bg-panel-subtle text-muted-copy hover:bg-panel-muted' : 'brand-button',
        )}
      >
        <SelectValue placeholder="All lists" />
      </SelectTrigger>
      <SelectContent className="max-w-72 panel-dropdown">
        <SelectItem value="all">All lists</SelectItem>
        <SelectItem value="unassigned">Unassigned</SelectItem>
        {lists.map(({ _id, name }) => (
          <SelectItem key={_id} value={_id} className="break-words whitespace-normal">
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
