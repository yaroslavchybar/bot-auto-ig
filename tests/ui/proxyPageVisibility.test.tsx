import { afterEach, expect, test, vi } from 'vite-plus/test'
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
