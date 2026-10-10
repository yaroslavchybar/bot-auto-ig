import { useCallback, useSyncExternalStore } from 'react'

function subscribeToHeaderSlots(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['id'],
  })
  return () => observer.disconnect()
}

// Returns the app-header slot element for portaling page controls.
// The slot renders on all widths; callers decide what to portal per breakpoint.
export function useHeaderSlot(id: string): HTMLElement | null {
  return useSyncExternalStore(
    subscribeToHeaderSlots,
    () => document.getElementById(id),
    () => null,
  )
}

// Measure the space left after the title, tabs, sidebar, and user controls.
// Returning null lets the page keep one toolbar below the header when it cannot fit.
export function useHeaderToolbarSlot(id: string, minimumWidth: number): HTMLElement | null {
  const slot = useHeaderSlot(id)
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!slot) return () => {}
      const observer = new ResizeObserver(onChange)
      observer.observe(slot)
      return () => observer.disconnect()
    },
    [slot],
  )
  const fits = useSyncExternalStore(
    subscribe,
    () => Boolean(slot && slot.clientWidth >= minimumWidth),
    () => false,
  )
  return fits ? slot : null
}
