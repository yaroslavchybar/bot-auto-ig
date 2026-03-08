import * as React from 'react'

const MOBILE_BREAKPOINT = 768

export function usePerformanceMode() {
  const [enabled, setEnabled] = React.useState(false)

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const viewportQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const pointerQuery = window.matchMedia('(pointer: coarse)')
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

    const update = () => {
      setEnabled(viewportQuery.matches || pointerQuery.matches || motionQuery.matches)
    }

    update()

    viewportQuery.addEventListener('change', update)
    pointerQuery.addEventListener('change', update)
    motionQuery.addEventListener('change', update)

    return () => {
      viewportQuery.removeEventListener('change', update)
      pointerQuery.removeEventListener('change', update)
      motionQuery.removeEventListener('change', update)
    }
  }, [])

  return enabled
}
