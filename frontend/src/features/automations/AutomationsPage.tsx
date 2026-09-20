import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { toast } from 'sonner'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { RoutinePopup } from './components/RoutinePopup'

export function AutomationsPage() {
  const rows = useQuery(api.automations.queries.list, {})
  const [editing, setEditing] = useState<Id<'automations'> | 'new' | null>(null)
  const toggle = useMutation(api.automations.mutations.setActive)
  const duplicate = useMutation(api.automations.mutations.duplicate)
  const remove = useMutation(api.automations.mutations.remove)
  const selected = rows?.find((a) => a._id === editing)
  const act = async (action: () => Promise<unknown>) => {
    try {
      await action()
    } catch (e) {
      toast.error(String(e))
    }
  }
  return (
    <div className="bg-shell text-ink h-full overflow-auto p-4 md:p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Automations</h1>
          <p className="text-subtle-copy text-sm">
            Daily IG routines, managed through profile lists.
          </p>
        </div>
        <Button onClick={() => setEditing('new')}>New automation</Button>
      </div>
      {rows === undefined ? (
        <p>Loading automations…</p>
      ) : rows.length === 0 ? (
        <p>
          Create an automation and select the profile lists it should manage.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((a) => (
            <div
              key={a._id}
              className="bg-panel border-line flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"
            >
              <button className="text-left" onClick={() => setEditing(a._id)}>
                <strong>{a.name}</strong>
                <p className="text-subtle-copy text-sm">
                  {a.isActive ? 'Enabled' : 'Disabled'} · {a.status ?? 'idle'} ·{' '}
                  {a.listIds?.length ?? 0} profile lists
                </p>
                {a.error && (
                  <p className="text-status-danger text-sm">{a.error}</p>
                )}
              </button>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setEditing(a._id)}>
                  Manage
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    void act(() => toggle({ id: a._id, isActive: !a.isActive }))
                  }
                >
                  {a.isActive ? 'Disable' : 'Enable'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => void act(() => duplicate({ id: a._id }))}
                >
                  Duplicate
                </Button>
                <Button
                  variant="ghost"
                  disabled={
                    a.isActive ||
                    a.status === 'running' ||
                    a.status === 'pending'
                  }
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete ${a.name}? Profile progress and lead history will remain.`,
                      )
                    )
                      void act(() => remove({ id: a._id }))
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {(editing === 'new' || selected) && (
        <RoutinePopup
          key={editing}
          automation={selected}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
