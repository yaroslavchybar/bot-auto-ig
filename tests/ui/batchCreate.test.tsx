import { act, StrictMode } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { BatchCreateForm } from '@/features/profiles/components/BatchCreateForm'
import { apiFetch } from '@/lib/api'
import { mount } from './mount'

vi.mock('convex/react', () => ({ useQuery: () => [] }))
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))

let view: ReturnType<typeof mount> | undefined

test('capped available totals display as 100+ rather than staying loading', async () => {
  vi.mocked(apiFetch).mockResolvedValue({ available: 100, capped: true })
  view = mount()
  await view.render(<BatchCreateForm onCreated={async () => {}} onCancel={() => {}} />)
  expect(view.container.textContent).toContain('Unused credentials: 100+')
  expect(view.container.textContent).not.toContain('loading...')
  expect(view.container.textContent).not.toContain('Requested count exceeds')
})

afterEach(async () => {
  await view?.unmount()
  view = undefined
})

test('Strict Mode and closing the dialog cancel obsolete account requests', async () => {
  const pending: Array<{ signal: AbortSignal; resolve: (rows: { available: number }) => void }> = []
  vi.mocked(apiFetch).mockImplementation(
    (_path, options) =>
      new Promise((resolve) => {
        pending.push({ signal: options!.signal!, resolve })
      }),
  )
  view = mount()
  await view.render(
    <StrictMode>
      <BatchCreateForm onCreated={async () => {}} onCancel={() => {}} />
    </StrictMode>,
  )
  expect(pending).toHaveLength(2)
  expect(pending[0].signal.aborted).toBe(true)
  expect(pending[1].signal.aborted).toBe(false)
  await act(async () => pending[1].resolve({ available: 1 }))
  const currentText = view.container.textContent
  await act(async () => pending[0].resolve({ available: 99 }))
  expect(view.container.textContent).toBe(currentText)
  await view.unmount()
  view = undefined
  expect(pending[1].signal.aborted).toBe(true)
})
