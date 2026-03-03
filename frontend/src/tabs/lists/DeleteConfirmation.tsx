import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog"
import { AlertCircle, X, Trash2 } from "lucide-react"
import { DenseButton } from "@/components/ui/dense-button"

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
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && !saving) onCancel()
      }}
    >
      <DialogContent hideClose className="p-0 border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 rounded-[3px] gap-0 border shadow-md w-[460px] max-w-[92vw] overflow-hidden flex flex-col font-sans select-none">

        <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-300 dark:border-neutral-700 bg-neutral-200/50 dark:bg-neutral-900/50 w-full shrink-0">
          <div className="flex items-center gap-2">
            <Trash2 className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
            <DialogTitle className="text-[11px] font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300 m-0 leading-none">Confirm Deletion</DialogTitle>
            <span className="text-[10px] text-neutral-500 font-mono">[DESTRUCTIVE ACTION]</span>
          </div>
          <DialogClose disabled={saving} className="rounded-[2px] opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-neutral-400 disabled:pointer-events-none disabled:opacity-50 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
            <X className="h-3.5 w-3.5" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </div>

        <div className="flex-1 w-full flex flex-col p-4 bg-white dark:bg-[#121212] gap-4">
          <div className="border border-red-200 dark:border-red-900/50 bg-red-50/80 dark:bg-red-950/30 rounded-[3px] px-3 py-2">
            <DialogDescription className="text-xs text-red-800 dark:text-red-200">
              Removing this list will permanently delete its mapping state.
            </DialogDescription>
          </div>

          <DialogDescription className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
            Delete list:
            <span className="ml-1 font-semibold text-neutral-900 dark:text-neutral-100 bg-neutral-100 dark:bg-neutral-800 px-1 py-0.5 rounded-[2px] border border-neutral-200 dark:border-neutral-700">
              {listName}
            </span>
          </DialogDescription>

          {error && (
            <div className="px-3 py-1.5 bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border border-red-200 dark:border-red-900/50 rounded-[3px] text-[10px] font-medium flex gap-2 w-full items-center">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="h-auto shrink-0 bg-neutral-200 dark:bg-neutral-800 border-t border-neutral-300 dark:border-neutral-700 px-3 py-2 flex items-center justify-end gap-2 text-[10px] text-neutral-500 dark:text-neutral-400">
          <DenseButton onClick={onCancel} disabled={saving}>
            Cancel
          </DenseButton>
          <DenseButton
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
            disabled={saving}
            className="bg-red-600 dark:bg-red-700 text-white hover:bg-red-700 dark:hover:bg-red-600 border-red-700 dark:border-red-600 font-medium px-4"
          >
            {saving ? 'Deleting...' : 'Confirm Delete'}
          </DenseButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}
