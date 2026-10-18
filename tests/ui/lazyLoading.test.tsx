import { Suspense } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { ROUTE_META } from '@/lib/routes'
import { mount } from './mount'

const loads = vi.hoisted(() => ({ profiles: 0 }))
vi.mock('@/features/profiles/ProfilesPage', () => {
  loads.profiles++
  return { ProfilesPage: () => <p>Profiles loaded</p> }
})

let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
})

test('pages are imported only when rendered', async () => {
  expect(loads).toEqual({ profiles: 0 })
  view = mount()
  const Page = ROUTE_META['/profiles'].Page
  await view.render(
    <Suspense fallback="Loading">
      <Page />
    </Suspense>,
  )
  await vi.waitFor(() => expect(view?.container.textContent).toBe('Profiles loaded'))
  expect(loads).toEqual({ profiles: 1 })
})
