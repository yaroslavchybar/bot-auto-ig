import { afterEach, expect, test, vi } from 'vite-plus/test'
import { getFunctionName } from 'convex/server'
import { ScrapeSourcesView } from '@/features/scraper/ScrapeSourcesView'
import { mount } from './mount'

const mocks = vi.hoisted(() => ({ count: 2 as number | null, ensure: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/router', () => ({
  useLocation: () => ({ search: '?listId=list' }),
  useNavigate: () => vi.fn(),
  Navigate: () => null,
}))
vi.mock('convex/react', () => ({
  useQuery: (reference: Parameters<typeof getFunctionName>[0]) => {
    switch (getFunctionName(reference)) {
      case 'leads:getList': return { _id: 'list', name: 'Saved', createdAt: 0 }
      case 'scrapeSources:sources': return []
      case 'scrapeSources:summary': return { sources: 0, leads: mocks.count }
      default: throw new Error('Unexpected query')
    }
  },
  useMutation: () => mocks.ensure,
  usePaginatedQuery: () => ({ results: [], status: 'Exhausted' }),
}))

let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
  mocks.ensure.mockClear()
  mocks.count = 2
})

test('detail counts retained leads after the last source is removed', async () => {
  view = mount()
  await view.render(<ScrapeSourcesView />)
  expect(view.container.textContent).toContain('0 sources · 2 leads')
  expect(mocks.ensure).not.toHaveBeenCalled()
})

test('existing lists backfill once and replace the loading count with the saved total', async () => {
  mocks.count = null
  view = mount()
  await view.render(<ScrapeSourcesView />)
  await view.render(<ScrapeSourcesView />)
  expect(view.container.textContent).toContain('0 sources · … leads')
  expect(mocks.ensure).toHaveBeenCalledExactlyOnceWith({ listId: 'list' })
  mocks.count = 2
  await view.render(<ScrapeSourcesView />)
  expect(view.container.textContent).toContain('0 sources · 2 leads')
  expect(mocks.ensure).toHaveBeenCalledTimes(1)
})
