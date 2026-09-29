import { useEffect, useState } from 'react'

// Returns the app-header slot element for portaling page controls.
// The slot renders on all widths; callers decide what to portal per breakpoint.
export function useHeaderSlot(id: string): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setSlot(document.getElementById(id))
  }, [id])

  return slot
}
