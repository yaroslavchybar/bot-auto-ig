import { useEffect, useState, type RefObject } from 'react'
import { createVisibilityGate } from '../utils/visibilityGate'
import { useNearViewport } from '@/hooks/use-near-viewport'
import { useDocumentVisibility } from '@/hooks/use-document-visibility'

export function useViewerVisibility(ref: RefObject<HTMLElement | null>, graceMs = 0) {
  const inViewport = useNearViewport(ref, '0px')
  const tabVisible = useDocumentVisibility()
  const visible = inViewport && tabVisible
  const [enabled, setEnabled] = useState(false)
  const [gate] = useState(() => createVisibilityGate(setEnabled, graceMs))
  useEffect(() => {
    gate.update(visible)
  }, [visible, gate])
  useEffect(() => () => gate.dispose(), [gate])
  return { visible, enabled }
}
