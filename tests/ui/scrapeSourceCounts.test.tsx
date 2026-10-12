import { act } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { getFunctionName } from 'convex/server'
import { ScrapeSourcesView } from '@/features/scraper/ScrapeSourcesView'
import { mount } from './mount'

const mocks = vi.hoisted(() => ({
  count: 2 as number | null,
  includePrivate: false,
  ensure: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/router', () => ({
  useLocation: () => ({ search: '?listId=list' }),
  useNavigate: () => vi.fn(),
  Navigate: () => null,
}))
vi.mock('convex/react', () => ({
  useQuery: (reference: Parameters<typeof getFunctionName>[0]) => {
    switch (getFunctionName(reference)) {
      case 'leads:getList':
        return {
          _id: 'list',
          name: 'Saved',
          createdAt: 0,
          scrapeIncludePrivate: mocks.includePrivate,
        }
      case 'scrapeSources:sources':
        return []
      case 'scrapeSources:summary':
        return { sources: 0, leads: mocks.count }
      default:
        throw new Error('Unexpected query')
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
  mocks.includePrivate = false
})

test('detail counts retained leads after the last source is removed', async () => {
  view = mount()
  await view.render(<ScrapeSourcesView />)
  expect(view.container.textContent).toContain('0 sources · 2 leads')
  expect(mocks.ensure).not.toHaveBeenCalled()
})

test('private-profile checkbox saves only on Save and restores the list preference', async () => {
  view = mount()
  await view.render(<ScrapeSourcesView />)
  const checkbox = view.container.querySelector<HTMLButtonElement>('#source-private-profiles')!
  expect(checkbox.getAttribute('aria-checked')).toBe('false')
  await act(async () => checkbox.click())
  expect(mocks.ensure).not.toHaveBeenCalled()
  const save = [...view.container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Save',
  )!
  await act(async () => save.click())
  expect(mocks.ensure).toHaveBeenCalledExactlyOnceWith({
    listId: 'list',
    days: 90,
    monitor: true,
    postLimit: 10,
    includePrivate: true,
  })
  mocks.includePrivate = true
  await view.unmount()
  view = mount()
  await view.render(<ScrapeSourcesView />)
  expect(
    view.container.querySelector('#source-private-profiles')?.getAttribute('aria-checked'),
  ).toBe('true')
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
