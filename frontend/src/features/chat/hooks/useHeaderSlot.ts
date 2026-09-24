import { useEffect, useState } from 'react'

// Returns the app-header slot element for portaling page controls.
// Only set on desktop widths — on mobile the slot is hidden and callers
// should fall back to rendering controls inline in the page.
export function useHeaderSlot(id: string): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)')
    const update = () => {
      setSlot(query.matches ? document.getElementById(id) : null)
    }
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [id])

  return slot
}
