import { Suspense } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { ROUTE_META } from '@/lib/routes'
import { CodeInput } from '@/features/automations/activity-ui/inputs/CodeInput'
import { mount } from './mount'

const loads = vi.hoisted(() => ({ profiles: 0, editor: 0 }))
vi.mock('@/features/profiles/ProfilesPage', () => {
  loads.profiles++
  return { ProfilesPage: () => <p>Profiles loaded</p> }
})
vi.mock('@/features/automations/activity-ui/TypeScriptCodeField', () => {
  loads.editor++
  return { TypeScriptCodeField: ({ value }: { value: string }) => <output>{value}</output> }
})

let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
})

test('pages and editors are imported only when rendered', async () => {
  expect(loads).toEqual({ profiles: 0, editor: 0 })
  view = mount()
  const Page = ROUTE_META['/profiles'].Page
  await view.render(
    <Suspense fallback="Loading">
      <Page />
    </Suspense>,
  )
  await vi.waitFor(() => expect(view?.container.textContent).toBe('Profiles loaded'))
  expect(loads).toEqual({ profiles: 1, editor: 0 })
  const input = { name: 'script', label: 'Script', type: 'code' as const }
  await view.render(<CodeInput input={input} value="first" onChange={() => {}} />)
  await vi.waitFor(() => expect(view?.container.textContent).toBe('first'))
  expect(loads).toEqual({ profiles: 1, editor: 1 })
  await view.render(<CodeInput input={input} value="second" onChange={() => {}} />)
  expect(view.container.textContent).toBe('second')
  expect(loads.editor).toBe(1)
})
