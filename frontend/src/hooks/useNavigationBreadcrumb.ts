import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { addNavigationBreadcrumb } from '@/lib/sentry'

/**
 * Tracks route changes and records Sentry navigation breadcrumbs.
 * Mount once near the top of the component tree (e.g. root layout).
 */
export function useNavigationBreadcrumb() {
  const location = useLocation()
  const prevPathRef = useRef(location.pathname)

  useEffect(() => {
    const prev = prevPathRef.current
    const next = location.pathname

    if (prev !== next) {
      addNavigationBreadcrumb(prev, next)
      prevPathRef.current = next
    }
  }, [location.pathname])
}
