import { useLocation } from 'react-router'
import { useDocumentVisibility } from './use-document-visibility'

/**
 * Returns `true` only when the browser tab is visible AND the current
 * pathname matches the given `route` exactly.
 *
 * Uses exact equality to match the keep-alive cache behavior — the
 * cached page is hidden when navigating to a sub-route (e.g. `/vnc`
 * is hidden on `/vnc/session/:id`), so prefix matching would
 * incorrectly keep side-effects running.
 *
 * Use this in keep-alive cached routes to pause side-effects
 * (polling, timers, WebSocket subscriptions) when the route is
 * hidden in the Activity cache but the tab is still visible.
 */
export function useRouteActive(route: string) {
  const isTabVisible = useDocumentVisibility()
  const { pathname } = useLocation()

  return isTabVisible && pathname === route
}
