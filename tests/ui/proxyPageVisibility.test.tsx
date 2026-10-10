import { afterEach, expect, test, vi } from 'vite-plus/test'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useProxiesPage } from '@/features/proxies/hooks/useProxiesPage'
import { mount } from './mount'

const mocks = vi.hoisted(() => ({
  ready: false,
  ensure: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('convex/react', () => ({
  useQuery: vi.fn((_reference, args) =>
    args === 'skip'
      ? undefined
      : {
          page: [],
          continueCursor: '',
          isDone: true,
          usageReady: mocks.ready,
        },
  ),
  useMutation: () => mocks.ensure,
}))

let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
  mocks.ready = false
  mocks.ensure.mockClear()
})

function Probe({ visible }: { visible: boolean }) {
  const state = useProxiesPage(visible)
  return <output>{state.loading ? 'loading' : 'ready'}</output>
}

test('hidden proxy pages skip the query and visible pages initialize usage once', async () => {
  view = mount()
  await view.render(<Probe visible={false} />)
  expect(useQuery).toHaveBeenLastCalledWith(api.proxies.listPage, 'skip')
  expect(mocks.ensure).not.toHaveBeenCalled()
  await view.render(<Probe visible />)
  expect(useQuery).toHaveBeenLastCalledWith(api.proxies.listPage, {
    search: '',
    cursor: null,
    pageSize: 50,
  })
  expect(mocks.ensure).toHaveBeenCalledTimes(1)
  await view.render(<Probe visible />)
  expect(mocks.ensure).toHaveBeenCalledTimes(1)
  await view.render(<Probe visible={false} />)
  expect(useQuery).toHaveBeenLastCalledWith(api.proxies.listPage, 'skip')
  mocks.ready = true
  await view.render(<Probe visible />)
  expect(mocks.ensure).toHaveBeenCalledTimes(1)
})
