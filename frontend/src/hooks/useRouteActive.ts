import { useLocation } from 'react-router'
import { useDocumentVisibility } from './use-document-visibility'

/**
 * Returns `true` only when the browser tab is visible AND the current
 * route starts with the given `routePrefix`.
 *
 * Use this in keep-alive cached routes to pause side-effects
 * (polling, timers, WebSocket subscriptions) when the route is
 * hidden in the Activity cache but the tab is still visible.
 */
export function useRouteActive(routePrefix: string) {
  const isTabVisible = useDocumentVisibility()
  const { pathname } = useLocation()

  return isTabVisible && pathname.startsWith(routePrefix)
}
