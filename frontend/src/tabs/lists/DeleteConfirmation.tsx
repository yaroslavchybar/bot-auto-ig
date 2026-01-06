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
import { AlertCircle } from "lucide-react"

interface DeleteConfirmationProps {
  listName: string
  saving: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
  open: boolean
}

export function DeleteConfirmation({ listName, saving, error, onConfirm, onCancel, open }: DeleteConfirmationProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && !saving) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete List</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete <span className="font-medium text-foreground">{listName}</span>? This action
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && (
          <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="font-medium">Error</span>
              <span>{error}</span>
            </div>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving} onClick={onCancel}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={saving}
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {saving ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
