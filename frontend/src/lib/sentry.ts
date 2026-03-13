import * as Sentry from '@sentry/react-router'

/**
 * Add a navigation breadcrumb when the route changes.
 */
export function addNavigationBreadcrumb(from: string, to: string) {
  Sentry.addBreadcrumb({
    category: 'navigation',
    message: `${from} → ${to}`,
    data: { from, to },
    level: 'info',
  })
}

/**
 * Add a breadcrumb for an outgoing API fetch call.
 */
export function addApiBreadcrumb(
  method: string,
  url: string,
  statusCode?: number,
) {
  Sentry.addBreadcrumb({
    category: 'api',
    message: `${method} ${url}`,
    data: { method, url, statusCode },
    level: statusCode && statusCode >= 400 ? 'error' : 'info',
  })
}

/**
 * Add a breadcrumb for WebSocket lifecycle events.
 */
export function addWebSocketBreadcrumb(
  event: 'open' | 'close' | 'error',
  url: string,
) {
  Sentry.addBreadcrumb({
    category: 'websocket',
    message: `WebSocket ${event}`,
    data: { url, event },
    level: event === 'error' ? 'error' : 'info',
  })
}
