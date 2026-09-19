import { createContext, use, type ReactNode } from 'react'
import type { BlockInsertionContext } from './automationEditorUtils'

export interface AutomationEditorContextValue {
  insertActivity: (
    activityId: string,
    insertionContext: BlockInsertionContext,
  ) => void
  /** True when a singleton activity is already on the canvas. */
  isActivityTaken: (activityId: string) => boolean
  setQuickAddMenuOpen: (open: boolean) => void
  openBlockLibrary: (insertionContext: BlockInsertionContext) => void
  duplicateNode: (nodeId: string) => void
  deleteNode: (nodeId: string) => void
  focusNode: (nodeId: string) => void
}

const AutomationEditorContext = createContext<AutomationEditorContextValue | null>(
  null,
)

export function AutomationEditorProvider({
  children,
  value,
}: {
  children: ReactNode
  value: AutomationEditorContextValue
}) {
  return (
    <AutomationEditorContext.Provider value={value}>
      {children}
    </AutomationEditorContext.Provider>
  )
}

export function useAutomationEditor() {
  const context = use(AutomationEditorContext)

  if (!context) {
    throw new Error('useAutomationEditor must be used inside AutomationEditorProvider')
  }

  return context
}
