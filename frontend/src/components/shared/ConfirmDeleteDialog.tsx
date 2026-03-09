import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface ConfirmDeleteDialogProps {
  open: boolean
  title: string
  entityLabel: string
  itemName: string
  confirmLabel: string
  saving: boolean
  error?: string | null
  extraDescription?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDeleteDialog({
  open,
  title,
  entityLabel,
  itemName,
  confirmLabel,
  saving,
  error,
  extraDescription,
  onConfirm,
  onCancel,
}: ConfirmDeleteDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && !saving) onCancel()
      }}
    >
      <AlertDialogContent className="bg-panel border-line text-ink">
        <AlertDialogHeader>
          <AlertDialogTitle className="brand-text-gradient">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-subtle-copy">
            This will permanently remove{' '}
            <span className="text-ink font-medium">{itemName}</span>
            {entityLabel ? ` ${entityLabel}` : ''}.
            {extraDescription ? ` ${extraDescription}` : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error ? (
          <div className="status-banner-danger rounded-md border p-2 px-3 text-[13px]">
            {error}
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={saving}
            onClick={onCancel}
            className="border-line text-copy hover:bg-panel-hover border bg-transparent shadow-none transition-all hover:text-ink"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={saving}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
            className="brand-button font-medium"
          >
            {saving ? 'Deleting...' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

