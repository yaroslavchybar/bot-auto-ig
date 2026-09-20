import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog'
import { AutomationsList } from './components/AutomationsList'
import { RoutinePopup } from './components/RoutinePopup'
import type { Automation } from './types'

export function AutomationsPage() {
  const rows = useQuery(api.automations.queries.list, {})
  const [editing, setEditing] = useState<Id<'automations'> | 'new' | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Automation | null>(null)
  const [saving, setSaving] = useState(false)
  const toggle = useMutation(api.automations.mutations.setActive)
  const duplicate = useMutation(api.automations.mutations.duplicate)
  const remove = useMutation(api.automations.mutations.remove)

  const selected =
    editing !== null && editing !== 'new'
      ? (rows?.find((a) => a._id === editing) ?? null)
      : null

  const act = async (action: () => Promise<unknown>) => {
    setSaving(true)
    try {
      await action()
    } catch (e) {
      toast.error(String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = (automation: Automation) =>
    void act(() =>
      toggle({ id: automation._id, isActive: !automation.isActive }),
    )

  const handleDuplicate = (automation: Automation) =>
    void act(() => duplicate({ id: automation._id }))

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return
    void act(async () => {
      await remove({ id: deleteTarget._id })
      setDeleteTarget(null)
    })
  }

  return (
    <div className="bg-shell text-ink animate-in fade-in relative flex h-full flex-col duration-300">
      <div className="relative z-10 flex-none px-4 pt-2 pb-2 md:px-6 md:pt-3 md:pb-3">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-end">
          <div className="flex shrink-0 gap-2 sm:flex-row md:ml-auto">
            <Button
              size="icon"
              onClick={() => setEditing('new')}
              disabled={saving}
              className="mobile-effect-shadow brand-button h-8 w-auto px-3.5 text-sm font-medium"
            >
              <Plus className="mr-2 h-4 w-4" />
              New Automation
            </Button>
          </div>
        </div>
      </div>

      <div className="relative z-10 flex-1 overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
        <div className="mx-auto max-w-[2000px]">
          <AutomationsList
            automations={rows ?? []}
            loading={rows === undefined}
            onToggleActive={handleToggleActive}
            onManage={(a) => setEditing(a._id)}
            onDuplicate={handleDuplicate}
            onDelete={setDeleteTarget}
          />
        </div>
      </div>

      {(editing === 'new' || selected) && (
        <RoutinePopup
          key={editing}
          automation={selected ?? undefined}
          onClose={() => setEditing(null)}
        />
      )}

      {deleteTarget ? (
        <ConfirmDeleteDialog
          open={Boolean(deleteTarget)}
          title="Delete Automation?"
          entityLabel="Profile progress and lead history will remain"
          itemName={deleteTarget.name}
          confirmLabel="Delete Automation"
          saving={saving}
          error={null}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
        />
      ) : null}
    </div>
  )
}
