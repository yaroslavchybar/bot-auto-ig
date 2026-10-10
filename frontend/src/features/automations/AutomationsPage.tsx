import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery } from 'convex/react'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { useHeaderToolbarSlot } from '@/components/layout/useHeaderSlot'
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
  // Desktop: New Automation moves into the app header. Mobile: it stays above the list.
  const headerSlot = useHeaderToolbarSlot('automations-header-slot', 210)

  const newAutomationButton = (
    <Button
      onClick={() => setEditing('new')}
      disabled={saving}
      className="brand-button font-medium"
    >
      <Plus className="mr-2 h-4 w-4" />
      New Automation
    </Button>
  )

  const selected =
    editing !== null && editing !== 'new' ? (rows?.find((a) => a._id === editing) ?? null) : null

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
    void act(() => toggle({ id: automation._id, isActive: !automation.isActive }))

  const handleDuplicate = (automation: Automation) =>
    void act(async () => {
      const copy = await duplicate({ id: automation._id })
      if (copy) setEditing(copy._id)
    })

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return
    void act(async () => {
      await remove({ id: deleteTarget._id })
      setDeleteTarget(null)
    })
  }

  return (
    <div className="relative flex h-full flex-col bg-shell text-ink">
      {headerSlot ? createPortal(newAutomationButton, headerSlot) : null}

      <div className="relative z-10 flex-1 overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
        {!headerSlot && <div className="flex justify-end pt-3 pb-3">{newAutomationButton}</div>}
        <AutomationsList
          automations={rows ?? []}
          loading={rows === undefined}
          onToggleActive={handleToggleActive}
          onManage={(a) => setEditing(a._id)}
          onDuplicate={handleDuplicate}
          onDelete={setDeleteTarget}
        />
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
