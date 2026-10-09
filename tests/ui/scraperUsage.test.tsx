import { act, type ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { getFunctionName } from 'convex/server'
import { usePaginatedQuery, useQuery } from 'convex/react'
import { ScraperPage } from '@/features/scraper/ScraperPage'
import { ScrapeSourcesView } from '@/features/scraper/ScrapeSourcesView'
import { mount } from './mount'

const mocks = vi.hoisted(() => ({
  search: '?tab=accounts',
  accounts: [{ id: 'profile', name: 'scraper', ready: true, dailyLimit: 1000, used: 0 }],
  lists: [{ _id: 'list', name: 'Purpose', createdAt: 0 }] as Array<{
    _id: string
    name: string
    createdAt: number
    scrapeLookbackDays?: number
    scrapeMonitor?: boolean
  }>,
  nearViewport: true,
  sources: [] as Array<{
    _id: string
    username: string
    enabled: boolean
    running: boolean
    nextCheckAt: number
    postCount: number
    discovered: number
  }>,
  leads: [],
  pageStatus: 'Exhausted',
  loadMore: vi.fn(),
  save: vi.fn(),
  navigate: vi.fn(),
}))
vi.mock('convex/react', () => ({
  useQuery: vi.fn(),
  usePaginatedQuery: vi.fn(),
  useMutation: () => mocks.save,
}))
vi.mock('@/lib/router', () => ({
  useLocation: () => ({ search: mocks.search }),
  useNavigate: () => mocks.navigate,
  Navigate: () => null,
}))
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))
vi.mock('@/hooks/use-now', () => ({ useNow: () => 0 }))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }))
vi.mock('@/hooks/use-near-viewport', () => ({ useNearViewport: () => mocks.nearViewport }))
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? children : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

let view: ReturnType<typeof mount> | undefined
beforeEach(() => {
  mocks.search = '?tab=accounts'
  mocks.pageStatus = 'Exhausted'
  mocks.sources = []
  mocks.lists = [{ _id: 'list', name: 'Purpose', createdAt: 0 }]
  mocks.nearViewport = true
  mocks.save.mockResolvedValue(undefined)
  vi.mocked(useQuery).mockImplementation((query, args?) => {
    if (args === 'skip') return undefined
    const name = getFunctionName(query)
    if (name === 'scraper:accounts') return mocks.accounts
    if (name === 'scrapeSources:sources') return mocks.sources
    if (name === 'scrapeSources:summary')
      return {
        sources: mocks.sources.length,
        leads: mocks.sources.reduce((n, s) => n + s.discovered, 0),
      }
    if (name === 'leads:getList')
      return (
        mocks.lists.find(
          (list) =>
            typeof args === 'object' && args && 'listId' in args && list._id === args.listId,
        ) ?? null
      )
    if (name === 'leads:lists') return mocks.lists
    throw new Error(`Unexpected query ${name}`)
  })
  vi.mocked(usePaginatedQuery).mockImplementation(() => ({
    results: mocks.leads,
    status: mocks.pageStatus as 'Exhausted' | 'CanLoadMore',
    loadMore: mocks.loadMore,
    isLoading: false,
  }))
})
afterEach(async () => {
  await view?.unmount()
  view = undefined
  vi.useRealTimers()
})

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

test('inactive tabs do not subscribe to source or post data', async () => {
  view = mount()
  await view.render(<ScraperPage />)
  expect(
    vi
      .mocked(useQuery)
      .mock.calls.some(([query]) => getFunctionName(query).startsWith('scrapeSources:')),
  ).toBe(false)
  expect(usePaginatedQuery).not.toHaveBeenCalled()
  vi.mocked(useQuery).mockClear()
  mocks.search = '?tab=sources'
  await view.render(<ScraperPage />)
  expect(
    vi.mocked(useQuery).mock.calls.some(([query]) => getFunctionName(query) === 'scraper:accounts'),
  ).toBe(false)
  expect(
    vi
      .mocked(useQuery)
      .mock.calls.some(
        ([query, args]) => getFunctionName(query) === 'scrapeSources:summary' && args !== 'skip',
      ),
  ).toBe(true)
  expect(usePaginatedQuery).not.toHaveBeenCalled()
  expect(
    vi.mocked(useQuery).mock.calls.some(([q]) => getFunctionName(q) === 'scrapeSources:sources'),
  ).toBe(false)
})

test('desktop list names are focusable and open details once, while row clicks also work', async () => {
  mocks.search = '?tab=sources'
  view = mount()
  await view.render(<ScraperPage />)
  const open = [...view.container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Purpose',
  )!
  open.focus()
  expect(document.activeElement).toBe(open)
  await act(async () => open.click())
  expect(mocks.navigate).toHaveBeenCalledTimes(1)
  expect(mocks.navigate).toHaveBeenLastCalledWith('/scraper?tab=sources&listId=list')
  await act(async () => open.closest('tr')!.click())
  expect(mocks.navigate).toHaveBeenCalledTimes(2)
})

test('overview limits summary subscriptions and skips offscreen lists', async () => {
  mocks.search = '?tab=sources'
  mocks.lists = Array.from({ length: 60 }, (_, i) => ({
    _id: `list${i}`,
    name: `Purpose ${i}`,
    createdAt: 0,
  }))
  view = mount()
  await view.render(<ScraperPage />)
  const summaries = () =>
    vi
      .mocked(useQuery)
      .mock.calls.filter(
        ([q, args]) => getFunctionName(q) === 'scrapeSources:summary' && args !== 'skip',
      )
  expect(summaries()).toHaveLength(20)
  expect(usePaginatedQuery).not.toHaveBeenCalled()
  const more = [...view.container.querySelectorAll('button')].find(
    (b) => b.textContent === 'Load more lists',
  )!
  vi.mocked(useQuery).mockClear()
  await act(async () => more.click())
  expect(
    new Set(
      summaries().map(
        ([, args]) => typeof args === 'object' && args && 'listId' in args && args.listId,
      ),
    ).size,
  ).toBe(40)
  mocks.nearViewport = false
  vi.mocked(useQuery).mockClear()
  await view.render(<ScraperPage />)
  expect(summaries()).toHaveLength(0)
  expect(
    vi.mocked(useQuery).mock.calls.some(([q]) => getFunctionName(q) === 'scrapeSources:sources'),
  ).toBe(false)
})

test('remote settings updates refresh the baseline without extra mutations', async () => {
  mocks.search = '?tab=sources&listId=list'
  view = mount()
  await view.render(<ScrapeSourcesView />)
  let input = view.container.querySelector<HTMLInputElement>('#source-days')!
  await typeInto(input, '7')
  mocks.lists = [{ ...mocks.lists[0], scrapeLookbackDays: 7 }]
  await view.render(<ScrapeSourcesView />)
  expect([...view.container.querySelectorAll('button')].some((b) => b.textContent === 'Save')).toBe(
    false,
  )
  input = view.container.querySelector<HTMLInputElement>('#source-days')!
  await typeInto(input, '8')
  mocks.lists = [{ ...mocks.lists[0], name: 'Renamed' }]
  await view.render(<ScrapeSourcesView />)
  expect(view.container.querySelector<HTMLInputElement>('#source-days')!.value).toBe('8')
  mocks.lists = [{ ...mocks.lists[0], scrapeLookbackDays: 14, scrapeMonitor: false }]
  await view.render(<ScrapeSourcesView />)
  expect(view.container.querySelector<HTMLInputElement>('#source-days')!.value).toBe('14')
  expect([...view.container.querySelectorAll('button')].some((b) => b.textContent === 'Save')).toBe(
    false,
  )
  expect(mocks.save).not.toHaveBeenCalled()
})

test('source settings save only explicit changes and posts load only when opened', async () => {
  mocks.search = '?tab=sources&listId=list'
  mocks.sources = [
    {
      _id: 'source',
      username: 'example',
      enabled: true,
      running: false,
      nextCheckAt: 0,
      postCount: 2,
      discovered: 3,
    },
  ]
  view = mount()
  await view.render(<ScraperPage />)
  const button = (text: string) =>
    [...view!.container.querySelectorAll('button')].find((b) => b.textContent === text)!
  expect(view.container.querySelector('#source-links')).toBeNull()
  expect([...view.container.querySelectorAll('button')].some((b) => b.textContent === 'Save')).toBe(
    false,
  )
  const days = view.container.querySelector<HTMLInputElement>('#source-days')!
  await typeInto(days, '7')
  expect(mocks.save).not.toHaveBeenCalled()
  await act(async () => button('Save').click())
  expect(mocks.save).toHaveBeenCalledWith({ listId: 'list', days: 7, monitor: true })
  expect(usePaginatedQuery).not.toHaveBeenCalled()
  await act(async () => button('View posts').click())
  expect(vi.mocked(usePaginatedQuery).mock.calls.at(-1)?.[1]).toEqual({ sourceId: 'source' })
  expect(vi.mocked(usePaginatedQuery).mock.calls.at(-1)?.[2]).toEqual({ initialNumItems: 50 })
  expect(vi.mocked(useQuery).mock.calls.some(([q]) => getFunctionName(q) === 'leads:lists')).toBe(
    false,
  )
  await act(async () => button('Hide posts').click())
  vi.mocked(usePaginatedQuery).mockClear()
  await typeInto(days, '8')
  expect(usePaginatedQuery).not.toHaveBeenCalled()
})

test('adding source profiles writes once to the selected list', async () => {
  mocks.search = '?tab=sources&listId=list'
  mocks.save.mockResolvedValue({ created: 2, duplicates: 0 })
  view = mount()
  await view.render(<ScraperPage />)
  const open = [...view.container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Add profiles',
  )!
  await act(async () => open.click())
  const input = view.container.querySelector<HTMLTextAreaElement>('#source-links')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      input,
      'https://www.instagram.com/example/\n@another',
    )
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(mocks.save).not.toHaveBeenCalled()
  const add = [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Add 2')!
  await act(async () => add.click())
  expect(mocks.save).toHaveBeenCalledTimes(1)
  expect(mocks.save).toHaveBeenCalledWith({
    listId: 'list',
    links: ['https://www.instagram.com/example/', '@another'],
  })
  expect(view.container.querySelector('#source-links')).toBeNull()
})

test('lead search waits for typing to settle and pauses obsolete pagination', async () => {
  vi.useFakeTimers()
  mocks.search = '?tab=saved'
  view = mount()
  await view.render(<ScraperPage />)
  const input = view.container.querySelector<HTMLInputElement>('input[aria-label="Search leads"]')!
  for (const value of ['A', 'Al', ' Alice ']) await typeInto(input, value)
  mocks.pageStatus = 'CanLoadMore'
  await view.render(<ScraperPage />)
  expect(mocks.loadMore).not.toHaveBeenCalled()
  expect(
    vi
      .mocked(usePaginatedQuery)
      .mock.calls.every(
        ([, args]) => args !== 'skip' && (!('search' in args) || args.search === undefined),
      ),
  ).toBe(true)
  await act(async () => {
    vi.advanceTimersByTime(299)
  })
  expect(mocks.loadMore).not.toHaveBeenCalled()
  await act(async () => {
    vi.advanceTimersByTime(1)
  })
  expect(vi.mocked(usePaginatedQuery).mock.calls.at(-1)?.[1]).toMatchObject({ search: 'alice' })
  expect(mocks.loadMore).toHaveBeenCalledTimes(1)
})

test('limit editing writes only a changed value after explicit Save', async () => {
  view = mount()
  await view.render(<ScraperPage />)
  const edit = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Edit scraper daily limit"]',
  )!
  await act(async () => edit.click())
  const save = [...view.container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Save',
  )!
  expect(save.disabled).toBe(true)
  const input = view.container.querySelector<HTMLInputElement>('#scraper-limit-value')!
  await typeInto(input, '1500')
  expect(mocks.save).not.toHaveBeenCalled()
  expect(save.disabled).toBe(false)
  await act(async () => save.click())
  expect(mocks.save).toHaveBeenCalledTimes(1)
  expect(mocks.save).toHaveBeenCalledWith({ profileId: 'profile', limit: 1500 })
})
