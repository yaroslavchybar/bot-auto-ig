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

export function DeleteTaskDialog({ open, onOpenChange, taskName, disabled, onConfirm }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-[#0a0a0a] border-white/10 text-gray-200">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-xl font-bold text-white">Delete task</AlertDialogTitle>
          <AlertDialogDescription className="text-gray-400">
            Are you sure you want to delete <span className="font-medium text-red-400">{taskName}</span>? This action
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-4">
          <AlertDialogCancel
            disabled={disabled}
            className="bg-transparent border-white/10 text-gray-300 hover:bg-white/5 hover:text-white"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={disabled}
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
            className="bg-red-500/10 text-red-500 border border-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.2)] hover:bg-red-500/20 transition-all font-semibold"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

