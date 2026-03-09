import * as React from 'react'

export function useDocumentVisibility() {
  const [isVisible, setIsVisible] = React.useState(() => {
    if (typeof document === 'undefined') {
      return true
    }

    return document.visibilityState !== 'hidden'
  })

  React.useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    const updateVisibility = () => {
      setIsVisible(document.visibilityState !== 'hidden')
    }

    updateVisibility()
    document.addEventListener('visibilitychange', updateVisibility)

    return () => {
      document.removeEventListener('visibilitychange', updateVisibility)
    }
  }, [])

  return isVisible
}


