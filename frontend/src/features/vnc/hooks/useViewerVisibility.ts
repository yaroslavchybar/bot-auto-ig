import { useEffect, useState, type RefObject } from 'react'
import { createVisibilityGate } from '../utils/visibilityGate'

export function useViewerVisibility(ref: RefObject<HTMLElement | null>, graceMs = 0) {
  const [visible, setVisible] = useState(false)
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    let inViewport = false
    const gate = createVisibilityGate(setEnabled, graceMs)
    const update = () => {
      const active = inViewport && document.visibilityState !== 'hidden'
      setVisible(active)
      gate.update(active)
    }
    const observer = new IntersectionObserver(([entry]) => {
      inViewport = entry.isIntersecting
      update()
    })
    observer.observe(element)
    document.addEventListener('visibilitychange', update)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', update)
      gate.dispose()
    }
  }, [ref, graceMs])
  return { visible, enabled }
}
