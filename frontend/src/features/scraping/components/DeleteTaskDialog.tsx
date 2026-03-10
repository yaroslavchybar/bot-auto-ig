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

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  taskName: string
  disabled: boolean
  onConfirm: () => void
}

export function DeleteTaskDialog({
  open,
  onOpenChange,
  taskName,
  disabled,
  onConfirm,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-panel border-line text-ink">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-xl font-bold text-ink">
            Delete task
          </AlertDialogTitle>
          <AlertDialogDescription className="text-muted-copy">
            Are you sure you want to delete{' '}
            <span className="text-status-danger font-medium">{taskName}</span>?
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-4">
          <AlertDialogCancel disabled={disabled}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={disabled}
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}


