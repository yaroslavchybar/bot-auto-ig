import { act, StrictMode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import {
  Navigate,
  RouterProvider,
  navigate,
  normalizeLocation,
  useLocation,
  useParams,
} from '@/lib/router'
import { mount } from './mount'

const routes = {
  '/profiles': { Page: () => null, breadcrumb: 'Profiles' },
  '/login': { Page: () => null, breadcrumb: 'Login' },
  '/vnc/session/:id': { Page: () => null, breadcrumb: 'Session' },
}

let view: ReturnType<typeof mount> | undefined

function Location() {
  const { pathname, search } = useLocation()
  const params = useParams()
  return (
    <output>
      {pathname}
      {search}:{params.id ?? ''}
    </output>
  )
}

beforeEach(() => window.history.replaceState(null, '', '/profiles'))

afterEach(async () => {
  await view?.unmount()
  view = undefined
  vi.restoreAllMocks()
})

test('bootstrap normalizes root while preserving query, hash, and history state', async () => {
  window.history.replaceState({ marker: 1 }, '', '/?profile=one#content')
  normalizeLocation()
  expect(window.location.pathname).toBe('/profiles')
  expect(window.location.search).toBe('?profile=one')
  expect(window.location.hash).toBe('#content')
  expect(window.history.state).toEqual({ marker: 1 })
  const replace = vi.spyOn(window.history, 'replaceState')
  view = mount()
  await view.render(
    <StrictMode>
      <RouterProvider routes={routes}>
        <Location />
      </RouterProvider>
    </StrictMode>,
  )
  expect(view.container.textContent).toBe('/profiles?profile=one:')
  expect(replace).not.toHaveBeenCalled()
})

test('initial child redirects are observed even before the provider subscribes', async () => {
  function Guard() {
    const { pathname } = useLocation()
    return pathname === '/profiles' ? <Navigate to="/login?next=profiles" replace /> : <Location />
  }
  view = mount()
  await view.render(
    <StrictMode>
      <RouterProvider routes={routes}>
        <Guard />
      </RouterProvider>
    </StrictMode>,
  )
  expect(view.container.textContent).toBe('/login?next=profiles:')
})

test('navigation and browser popstate update deep links and decoded parameters', async () => {
  view = mount()
  await view.render(
    <RouterProvider routes={routes}>
      <Location />
    </RouterProvider>,
  )
  await act(async () => navigate('/vnc/session/account%20one?view=live'))
  expect(view.container.textContent).toBe('/vnc/session/account%20one?view=live:account one')
  await act(async () => {
    window.history.replaceState(null, '', '/?profile=two')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  expect(view.container.textContent).toBe('/profiles?profile=two:')
  expect(window.location.pathname).toBe('/profiles')
  await act(async () => navigate('/login', { replace: true }))
  expect(view.container.textContent).toBe('/login:')
})
