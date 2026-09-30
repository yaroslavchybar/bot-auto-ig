import { useEffect, useState, type RefObject } from 'react'

type ObserverGroup = {
  observer: IntersectionObserver
  listeners: Map<Element, (visible: boolean) => void>
}
const groups = new Map<string, ObserverGroup>()

// A single observer serves all previews; unmounting releases its element references.
export function useNearViewport(ref: RefObject<Element | null>, rootMargin = '250px') {
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    let group = groups.get(rootMargin)
    if (!group) {
      const listeners = new Map<Element, (visible: boolean) => void>()
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting)
        },
        { rootMargin },
      )
      group = { observer, listeners }
      groups.set(rootMargin, group)
    }
    const { observer, listeners } = group
    listeners.set(element, setVisible)
    observer.observe(element)
    return () => {
      observer.unobserve(element)
      listeners.delete(element)
      if (listeners.size === 0) {
        observer.disconnect()
        groups.delete(rootMargin)
      }
    }
  }, [ref, rootMargin])
  return visible
}
