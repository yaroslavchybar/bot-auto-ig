import { Archive, ArchiveRestore } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ChatArchiveAction({
  archived,
  disabled,
  onChange,
}: {
  archived: boolean
  disabled: boolean
  onChange: (archived: boolean) => Promise<void>
}) {
  const label = archived ? 'Move to inbox' : 'Archive chat'
  return (
    <Button
      variant="outline"
      className="shrink-0"
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={() => void onChange(!archived)}
    >
      {archived ? <ArchiveRestore /> : <Archive />}
      <span className="hidden sm:inline">{archived ? 'Move to inbox' : 'Archive'}</span>
    </Button>
  )
}
