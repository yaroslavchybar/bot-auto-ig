import { act } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { ModelImage } from '@/features/lists/components/ModelImage'
import { apiFetchBlob } from '@/lib/api'
import { mount } from './mount'

vi.mock('@/lib/api', () => ({ apiFetchBlob: vi.fn() }))

let view: ReturnType<typeof mount> | undefined

afterEach(async () => {
  await view?.unmount()
  view = undefined
  vi.unstubAllGlobals()
})

test('switching images clears old content, aborts its request, and revokes its URL', async () => {
  const createObjectURL = vi.fn(() => 'blob:first')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
  let resolveSecond: (blob: Blob) => void = () => {}
  vi.mocked(apiFetchBlob)
    .mockResolvedValueOnce(new Blob(['first']))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve
        }),
    )
  const first = {
    id: 'first',
    kind: 'posts' as const,
    name: 'First',
    variantCount: 0,
    usedCount: 0,
  }
  view = mount()
  await view.render(<ModelImage modelId="model" item={first} />)
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:first')
  const firstSignal = vi.mocked(apiFetchBlob).mock.calls[0][1]?.signal
  await view.render(
    <ModelImage modelId="model" item={{ ...first, id: 'second', name: 'Second' }} />,
  )
  expect(view.container.querySelector('img')).toBeNull()
  expect(firstSignal?.aborted).toBe(true)
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:first')
  createObjectURL.mockReturnValue('blob:second')
  await act(async () => {
    resolveSecond(new Blob(['second']))
  })
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:second')
  expect(view.container.querySelector('img')?.alt).toBe('Second')
})
