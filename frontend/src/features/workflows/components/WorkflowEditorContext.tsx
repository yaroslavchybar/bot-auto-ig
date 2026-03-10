import { createContext, useContext, type ReactNode } from 'react'
import type { BlockInsertionContext } from './workflowEditorUtils'

export interface WorkflowEditorContextValue {
  insertActivity: (
    activityId: string,
    insertionContext: BlockInsertionContext,
  ) => void
  setQuickAddMenuOpen: (open: boolean) => void
  openBlockLibrary: (insertionContext: BlockInsertionContext) => void
  duplicateNode: (nodeId: string) => void
  deleteNode: (nodeId: string) => void
  focusNode: (nodeId: string) => void
}

const WorkflowEditorContext = createContext<WorkflowEditorContextValue | null>(
  null,
)

export function WorkflowEditorProvider({
  children,
  value,
}: {
  children: ReactNode
  value: WorkflowEditorContextValue
}) {
  return (
    <WorkflowEditorContext.Provider value={value}>
      {children}
    </WorkflowEditorContext.Provider>
  )
}

export function useWorkflowEditor() {
  const context = useContext(WorkflowEditorContext)

  if (!context) {
    throw new Error('useWorkflowEditor must be used inside WorkflowEditorProvider')
  }

  return context
}
