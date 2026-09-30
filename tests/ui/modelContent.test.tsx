import { act, StrictMode } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { ModelContentProvider, useModelContent } from '@/features/lists/hooks/useModelContent'
import { apiFetch } from '@/lib/api'
import { mount } from './mount'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))
let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
})

function Content({ id }: { id: string }) {
  const { items, reload } = useModelContent(id)
  return (
    <div>
      <output>
        {id}:{items[0]?.name}
      </output>
      <button onClick={() => void reload()}>Reload {id}</button>
    </div>
  )
}

test('cards and dialogs share data and mutations refresh only the affected model', async () => {
  vi.mocked(apiFetch).mockResolvedValue([{ id: 'image', kind: 'posts', name: 'original' }])
  view = mount()
  await view.render(
    <ModelContentProvider>
      <Content id="model-a" />
      <Content id="model-a" />
      <Content id="model-b" />
    </ModelContentProvider>,
  )
  expect(apiFetch).toHaveBeenCalledTimes(2)
  expect(view.container.querySelectorAll('output')[1].textContent).toBe('model-a:original')
  vi.mocked(apiFetch).mockResolvedValue([{ id: 'image', kind: 'posts', name: 'updated' }])
  await act(async () => {
    view?.container.querySelector('button')?.click()
  })
  expect(apiFetch).toHaveBeenCalledTimes(3)
  expect([...view.container.querySelectorAll('output')].map((el) => el.textContent)).toEqual([
    'model-a:updated',
    'model-a:updated',
    'model-b:original',
  ])
  await view.render(
    <ModelContentProvider>
      <Content id="model-a" />
      <Content id="model-b" />
    </ModelContentProvider>,
  )
  expect(apiFetch).toHaveBeenCalledTimes(3)
})

test('Strict Mode aborts obsolete content requests and unmount cancels pending work', async () => {
  vi.mocked(apiFetch).mockImplementation(() => new Promise(() => {}))
  view = mount()
  await view.render(
    <StrictMode>
      <ModelContentProvider>
        <Content id="model-a" />
        <Content id="model-a" />
      </ModelContentProvider>
    </StrictMode>,
  )
  const calls = vi.mocked(apiFetch).mock.calls
  expect(calls).toHaveLength(2)
  expect(calls[0][1]?.signal?.aborted).toBe(true)
  expect(calls[1][1]?.signal?.aborted).toBe(false)
  await view.unmount()
  view = undefined
  expect(calls[1][1]?.signal?.aborted).toBe(true)
})
