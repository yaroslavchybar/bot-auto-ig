import { useSyncExternalStore } from 'react'

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
