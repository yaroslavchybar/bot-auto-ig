import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

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
  open
}: DeleteConfirmationProps) {
  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen && !saving) onCancel()
    }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Profile?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently remove <span className="font-medium text-foreground">{profileName}</span> and its data.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && (
          <div className="text-[13px] text-destructive bg-destructive/5 p-2 px-3 rounded-md border border-destructive/10">
            {error}
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving} onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={saving}
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {saving ? "Deleting..." : "Delete Profile"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
