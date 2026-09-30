type SentryModule = typeof import('@sentry/react')
let sentry: SentryModule | undefined
let initializing = false
const pending: Array<(sdk: SentryModule) => void> = []

function report(callback: (sdk: SentryModule) => void) {
  if (!import.meta.env.VITE_SENTRY_DSN) return
  if (sentry) callback(sentry)
  else {
    if (pending.length >= 20) pending.shift()
    pending.push(callback)
  }
}

export function captureException(...args: Parameters<SentryModule['captureException']>) {
  report((sdk) => sdk.captureException(...args))
}

function addBreadcrumb(...args: Parameters<SentryModule['addBreadcrumb']>) {
  report((sdk) => sdk.addBreadcrumb(...args))
}

export function initializeSentry() {
  if (initializing || !import.meta.env.VITE_SENTRY_DSN) return
  initializing = true
  void import('@sentry/react')
    .then((sdk) => {
      sdk.init({
        dsn: import.meta.env.VITE_SENTRY_DSN,
        environment: import.meta.env.MODE,
        tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
        // Keep the previous data collection settings when upgrading to Sentry 11.
        dataCollection: {
          userInfo: false,
          cookies: false,
          httpHeaders: {
            request: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
            response: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
          },
          httpBodies: [],
          urlQueryParams: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
          genAI: { inputs: false, outputs: false },
          databaseQueryData: false,
          queues: false,
          graphQL: { document: false, variables: false },
        },
      })
      sentry = sdk
      pending.splice(0).forEach((callback) => callback(sdk))
    })
    .catch(() => {
      pending.length = 0
      console.warn('Error reporting could not initialize')
    })
}

/**
 * Add a navigation breadcrumb when the route changes.
 */
export function addNavigationBreadcrumb(from: string, to: string) {
  addBreadcrumb({
    category: 'navigation',
    message: `${from} → ${to}`,
    data: { from, to },
    level: 'info',
  })
}

/**
 * Add a breadcrumb for an outgoing API fetch call.
 */
export function addApiBreadcrumb(method: string, url: string, statusCode?: number) {
  addBreadcrumb({
    category: 'api',
    message: `${method} ${url}`,
    data: { method, url, statusCode },
    level: statusCode && statusCode >= 400 ? 'error' : 'info',
  })
}

/**
 * Add a breadcrumb for WebSocket lifecycle events.
 */
export function addWebSocketBreadcrumb(event: 'open' | 'close' | 'error', url: string) {
  addBreadcrumb({
    category: 'websocket',
    message: `WebSocket ${event}`,
    data: { url, event },
    level: event === 'error' ? 'error' : 'info',
  })
}
