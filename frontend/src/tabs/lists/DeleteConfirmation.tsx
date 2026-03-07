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
  listName: string
  saving: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
  open: boolean
}

export function DeleteConfirmation({
  listName,
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
      <AlertDialogContent className="bg-[#0a0a0a] border-white/10 text-gray-200">
        <AlertDialogHeader>
          <AlertDialogTitle className="bg-gradient-to-r from-red-500 to-orange-400 bg-clip-text text-transparent">Delete List?</AlertDialogTitle>
          <AlertDialogDescription className="text-gray-500">
            This will permanently remove <span className="font-medium text-gray-200">{listName}</span>.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && (
          <div className="text-[13px] text-red-400 bg-red-500/10 p-2 px-3 rounded-md border border-red-500/20 shadow-[0_0_10px_rgba(239,68,68,0.2)]">
            {error}
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving} onClick={onCancel} className="bg-transparent border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition-all shadow-none">Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={saving}
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
            className="border-none bg-gradient-to-r from-red-600 to-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)] hover:shadow-[0_0_25px_rgba(239,68,68,0.6)] hover:from-red-500 hover:to-orange-500 transition-all font-medium"
          >
            {saving ? "Deleting..." : "Delete List"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
