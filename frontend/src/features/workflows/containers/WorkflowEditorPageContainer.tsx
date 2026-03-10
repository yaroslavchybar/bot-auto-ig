import { useCallback, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { useNavigate, useParams } from 'react-router'
import type { Edge, Node } from 'reactflow'
import { ArrowLeft } from 'lucide-react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { WorkflowFlowEditor } from '../components/WorkflowFlowEditor'

function buildUnavailableMessage(workflowId: string | undefined) {
  if (!workflowId) {
    return 'Workflow ID is missing.'
  }

  return 'This workflow is unavailable or no longer exists.'
}

export function WorkflowEditorPageContainer() {
  const navigate = useNavigate()
  const { workflowId } = useParams()
  const updateWorkflow = useMutation(api.workflows.update)
  const workflow = useQuery(
    api.workflows.get,
    workflowId ? { id: workflowId as Id<'workflows'> } : 'skip',
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleBack = useCallback(() => {
    navigate('/workflows')
  }, [navigate])

  const handleSave = useCallback(
    async (nodes: Node[], edges: Edge[]) => {
      if (!workflowId) return

      setSaving(true)
      setError(null)

      try {
        await updateWorkflow({
          id: workflowId as Id<'workflows'>,
          nodes: nodes as unknown as Array<Record<string, unknown>>,
          edges: edges as unknown as Array<Record<string, unknown>>,
        })
        navigate('/workflows')
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setSaving(false)
      }
    },
    [navigate, updateWorkflow, workflowId],
  )

  if (!workflowId) {
    return (
      <div className="bg-shell flex h-full flex-col overflow-hidden">
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="bg-panel border-line flex w-full max-w-lg flex-col gap-4 rounded-2xl border p-6 text-center shadow-xs">
            <div>
              <h1 className="text-ink text-lg font-semibold">
                Workflow unavailable
              </h1>
              <p className="text-subtle-copy mt-2 text-sm">
                {buildUnavailableMessage(workflowId)}
              </p>
            </div>
            <div className="flex justify-center">
              <Button onClick={handleBack} className="brand-button">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Workflows
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (workflow === undefined) {
    return (
      <div className="bg-shell text-subtle-copy flex h-full items-center justify-center text-sm">
        Loading workflow editor...
      </div>
    )
  }

  if (!workflow) {
    return (
      <div className="bg-shell flex h-full flex-col overflow-hidden">
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="bg-panel border-line flex w-full max-w-lg flex-col gap-4 rounded-2xl border p-6 text-center shadow-xs">
            <div>
              <h1 className="text-ink text-lg font-semibold">
                Workflow unavailable
              </h1>
              <p className="text-subtle-copy mt-2 text-sm">
                {buildUnavailableMessage(workflowId)}
              </p>
            </div>
            <div className="flex justify-center">
              <Button onClick={handleBack} className="brand-button">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Workflows
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-shell flex h-full flex-col overflow-hidden">
      {error ? (
        <div className="bg-status-danger-soft text-status-danger border-status-danger-border border-b px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        <WorkflowFlowEditor
          workflow={workflow}
          saving={saving}
          onSave={handleSave}
          onClose={handleBack}
        />
      </div>
    </div>
  )
}
