import { useCallback, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { useNavigate, useParams } from '@/lib/router'
import type { Edge, Node } from 'reactflow'
import { ArrowLeft } from 'lucide-react'
import { api } from './../../../../convex/_generated/api'
import type { Id } from './../../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { AutomationFlowEditor } from './components/AutomationFlowEditor'
import { useErrorHandler } from '@/hooks/useErrorHandler'

function buildUnavailableMessage(automationId: string | undefined) {
  if (!automationId) {
    return 'Automation ID is missing.'
  }

  return 'This automation is unavailable or no longer exists.'
}

/* ── Unavailable state view ── */

function AutomationUnavailableView({
  automationId,
  onBack,
}: {
  automationId: string | undefined
  onBack: () => void
}) {
  return (
    <div className="bg-shell flex h-full flex-col overflow-hidden">
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="bg-panel border-line flex w-full max-w-lg flex-col gap-4 rounded-2xl border p-6 text-center shadow-xs">
          <div>
            <h1 className="text-ink text-lg font-semibold">
              Automation unavailable
            </h1>
            <p className="text-subtle-copy mt-2 text-sm">
              {buildUnavailableMessage(automationId)}
            </p>
          </div>
          <div className="flex justify-center">
            <Button onClick={onBack} className="brand-button">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Automations
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Loading state view ── */

function AutomationLoadingView() {
  return (
    <div className="bg-shell text-subtle-copy flex h-full items-center justify-center text-sm">
      Loading automation editor...
    </div>
  )
}

/* ── Main Component ── */

export function AutomationEditorPage() {
  const navigate = useNavigate()
  const { automationId } = useParams()
  const updateAutomation = useMutation(api.automations.mutations.update)
  const { handleError } = useErrorHandler()
  const automation = useQuery(
    api.automations.queries.get,
    automationId ? { id: automationId } : 'skip',
  )
  const [saving, setSaving] = useState(false)

  const handleBack = useCallback(() => {
    navigate('/automations')
  }, [navigate])

  const handleSave = useCallback(
    async (nodes: Node[], edges: Edge[]) => {
      if (!automationId) return
      setSaving(true)
      try {
        await updateAutomation({
          id: automationId as Id<'automations'>,
          nodes: nodes as unknown as Array<Record<string, unknown>>,
          edges: edges as unknown as Array<Record<string, unknown>>,
        })
        navigate('/automations')
      } catch (cause) {
        handleError(cause, 'Save automation')
      } finally {
        setSaving(false)
      }
    },
    [handleError, navigate, updateAutomation, automationId],
  )

  if (!automationId || !automation) {
    if (automation === undefined && automationId) {
      return <AutomationLoadingView />
    }
    return <AutomationUnavailableView automationId={automationId} onBack={handleBack} />
  }

  return (
    <div className="bg-shell flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1">
        <AutomationFlowEditor
          automation={automation}
          saving={saving}
          onSave={handleSave}
          onClose={handleBack}
        />
      </div>
    </div>
  )
}
