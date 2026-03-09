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

interface DeleteConfirmationProps {
  profileName: string
  saving: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
  open: boolean
}

export function DeleteConfirmation({
  profileName,
  saving,
  error,
  onConfirm,
  onCancel,
  open,
}: DeleteConfirmationProps) {
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
            Delete Profile?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-subtle-copy">
            This will permanently remove{' '}
            <span className="text-ink font-medium">{profileName}</span> and its
            data.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && (
          <div className="status-banner-danger rounded-md border p-2 px-3 text-[13px]">
            {error}
          </div>
        )}

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
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
            className="brand-button font-medium"
          >
            {saving ? 'Deleting...' : 'Delete Profile'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
