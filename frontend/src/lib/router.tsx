import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'
import type { RouteMeta } from '@/lib/routes'

// Minimal client-side router built on the History API.
// Replaces react-router: no SSR, no loaders, just pathname matching.

type MatchedRoute = {
  pattern: string
  params: Record<string, string>
  meta?: RouteMeta
}

function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean)
  const pathParts = pathname.split('/').filter(Boolean)

  if (patternParts.length !== pathParts.length) return null

  const params: Record<string, string> = {}
  for (let i = 0; i < patternParts.length; i += 1) {
    const patternPart = patternParts[i]
    const pathPart = pathParts[i]
    if (!patternPart || pathPart === undefined) return null
    if (patternPart.startsWith(':')) {
      try {
        params[patternPart.slice(1)] = decodeURIComponent(pathPart)
      } catch {
        params[patternPart.slice(1)] = pathPart
      }
    } else if (patternPart !== pathPart) {
      return null
    }
  }
  return params
}

export function matchRoute(
  pathname: string,
  routes: Record<string, RouteMeta>,
): MatchedRoute | null {
  // Treat "/profiles/" the same as "/profiles".
  const normalized =
    pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname

  // Exact static routes first (cheapest + most common).
  const exactMeta = routes[normalized]
  if (exactMeta) return { pattern: normalized, params: {}, meta: exactMeta }

  for (const pattern of Object.keys(routes)) {
    if (!pattern.includes(':')) continue
    const params = matchPattern(pattern, normalized)
    if (params) return { pattern, params, meta: routes[pattern] }
  }
  return null
}

export type NavigateOptions = {
  replace?: boolean
}

export function navigate(to: string, options?: NavigateOptions) {
  if (typeof window === 'undefined') return
  if (options?.replace) {
    window.history.replaceState(null, '', to)
  } else {
    window.history.pushState(null, '', to)
  }
  window.dispatchEvent(new PopStateEvent('popstate'))
}

const DEFAULT_ROUTE = '/profiles'

function readLocation() {
  // Canonicalize the root path up front so the first render already shows
  // the default page. A <Navigate> redirect in render would only run after
  // mount (returning blank UI meanwhile) and its popstate event would fire
  // before RouterProvider subscribes below, leaving the app stuck blank.
  if (window.location.pathname === '/') {
    window.history.replaceState(null, '', DEFAULT_ROUTE + window.location.search)
    return { pathname: DEFAULT_ROUTE, search: window.location.search }
  }
  return {
    pathname: window.location.pathname,
    search: window.location.search,
  }
}

type RouterContextValue = {
  pathname: string
  search: string
  params: Record<string, string>
  pattern: string | null
  navigate: (to: string, options?: NavigateOptions) => void
}

const RouterContext = createContext<RouterContextValue>({
  pathname: '/',
  search: '',
  params: {},
  pattern: null,
  navigate,
})

export function RouterProvider({
  children,
  routes,
}: {
  children: ReactNode
  routes: Record<string, RouteMeta>
}) {
  const [location, setLocation] = useState(readLocation)

  useEffect(() => {
    const onChange = () => setLocation(readLocation())
    // A <Navigate> rendered on the initial mount (e.g. AuthGuard -> /login)
    // fires before this subscription exists, so its popstate event is lost.
    // Re-read the URL after subscribing to recover instead of staying stuck.
    onChange()
    window.addEventListener('popstate', onChange)
    return () => window.removeEventListener('popstate', onChange)
  }, [])

  const value = useMemo<RouterContextValue>(() => {
    const match = matchRoute(location.pathname, routes)
    return {
      pathname: location.pathname,
      search: location.search,
      params: match?.params ?? {},
      pattern: match?.pattern ?? null,
      navigate,
    }
  }, [location, routes])

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function useLocation() {
  const { pathname, search } = useContext(RouterContext)
  return { pathname, search }
}

export function useNavigate() {
  const { navigate: navigateFn } = useContext(RouterContext)
  return useCallback(
    (to: string, options?: NavigateOptions) => navigateFn(to, options),
    [navigateFn],
  )
}

export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  return useContext(RouterContext).params as T
}

export function useSearchParams(): [URLSearchParams] {
  const { search } = useContext(RouterContext)
  return useMemo(() => [new URLSearchParams(search)], [search])
}

export function Navigate({ to, replace = false }: { to: string; replace?: boolean }) {
  const navigateFn = useNavigate()
  useEffect(() => {
    navigateFn(to, { replace })
  }, [navigateFn, to, replace])
  return null
}

export function Link({
  to,
  replace,
  children,
  className,
}: {
  to: string
  replace?: boolean
  children: ReactNode
  className?: string
}) {
  const navigateFn = useNavigate()

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    event.preventDefault()
    navigateFn(to, { replace })
  }

  return (
    <a href={to} onClick={handleClick} className={className}>
      {children}
    </a>
  )
}
