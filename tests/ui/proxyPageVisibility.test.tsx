import { afterEach, expect, test, vi } from 'vite-plus/test'
import { act, useEffect } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useProxiesPage } from '@/features/proxies/hooks/useProxiesPage'
import { mount } from './mount'

vi.mock('convex/react', () => ({
  useMutation: () => vi.fn(),
  useQuery: vi.fn((_reference, args) =>
    args === 'skip'
      ? undefined
      : {
          page: [],
          continueCursor: '',
          isDone: true,
        },
  ),
}))

let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
})

function Probe({ visible }: { visible: boolean }) {
  const state = useProxiesPage(visible)
  return <output>{state.loading ? 'loading' : 'ready'}</output>
}

test('proxy pages query only while visible', async () => {
  view = mount()
  await view.render(<Probe visible={false} />)
  expect(useQuery).toHaveBeenLastCalledWith(api.proxies.listPage, 'skip')
  await view.render(<Probe visible />)
  expect(useQuery).toHaveBeenLastCalledWith(api.proxies.listPage, {
    search: '',
    cursor: null,
    pageSize: 50,
  })
  await view.render(<Probe visible />)
  await view.render(<Probe visible={false} />)
  expect(useQuery).toHaveBeenLastCalledWith(api.proxies.listPage, 'skip')
  await view.render(<Probe visible />)
  expect(useQuery).not.toHaveBeenLastCalledWith(api.proxies.listPage, 'skip')
})

test('proxy dialogs keep their selection when the live table page changes', async () => {
  const proxy = { _id: 'proxy', name: 'Selected', proxy: 'http://example.test:8080', proxyType: 'http', purpose: 'work', maxProfiles: 3, usage: 0 }
  vi.mocked(useQuery).mockReturnValue({ page: [proxy], isDone: true, continueCursor: '' } as never)
  let state!: ReturnType<typeof useProxiesPage>
  function DialogProbe() {
    const current = useProxiesPage()
    useEffect(() => { state = current })
    return <output>{current.editProxy?.name}/{current.deleteTarget?.name}</output>
  }
  view = mount()
  await view.render(<DialogProbe />)
  await act(async () => {
    state.handleEdit(state.proxies[0])
    state.handleDeleteClick(state.proxies[0])
  })
  vi.mocked(useQuery).mockReturnValue({ page: [], isDone: true, continueCursor: '' } as never)
  await view.render(<DialogProbe />)
  expect(view.container.textContent).toBe('Selected/Selected')
  await act(async () => { state.handleCloseEdit(); state.handleCloseDelete() })
  expect(view.container.textContent).toBe('/')
})
