import { act, useReducer, type ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { getFunctionName } from 'convex/server'
import { ConvexError } from 'convex/values'
import type { ComponentProps } from 'react'
import { LeadsList } from '@/features/scraper/LeadsList'
import { usePaginatedQuery, useQuery } from 'convex/react'
import { ScraperPage } from '@/features/scraper/ScraperPage'
import { ScrapeSourcesView } from '@/features/scraper/ScrapeSourcesView'
import { mount } from './mount'

const mocks = vi.hoisted(() => ({
  search: '?tab=accounts',
  accounts: [
    {
      id: 'profile',
      name: 'scraper',
      ready: true,
      hourlyLimit: 10,
      used: 0,
      requestTimes: [] as number[],
      timezone: 'Europe/London',
      country: 'gb',
      wakeMinute: 420,
      availableAt: 0,
      sleeping: false,
    },
  ],
  lists: [{ _id: 'list', name: 'Purpose', createdAt: 0 }] as Array<{
    _id: string
    name: string
    createdAt: number
    scrapeLookbackDays?: number
    scrapeMonitor?: boolean
    scrapePostLimit?: number
  }>,
  nearViewport: true,
  sources: [] as Array<{
    _id: string
    username: string
    enabled: boolean
    running: boolean
    nextCheckAt: number
    postCount: number
    leadsAdded: number
    runKind?: 'posts' | 'likers'
    currentPostId?: string
    lastPostsCheckAt?: number
    lastLikerCheckAt?: number
  }>,
  leads: [],
  notifyLeads: () => {},
  leadPages: {} as Record<string, {
    page: ComponentProps<typeof LeadsList>['leads']; isDone: boolean; continueCursor: string
  } | Error>,
  pageStatus: 'Exhausted',
  loadMore: vi.fn(),
  save: vi.fn(),
  navigate: vi.fn(),
}))
vi.mock('convex/react', () => ({
  useQuery: vi.fn(),
  useQueries: function useMockQueries(queries: Record<string, { query: Parameters<typeof useQuery>[0]; args: Record<string, unknown> }>) {
    const [, refresh] = useReducer(n => n + 1, 0)
    mocks.notifyLeads = refresh
    return Object.fromEntries(Object.entries(queries).map(([key, { query, args }]) => [key, vi.mocked(useQuery)(query, args)]))
  },
  usePaginatedQuery: vi.fn(),
  useMutation: () => mocks.save,
}))
vi.mock('@/lib/router', () => ({
  useLocation: () => ({ search: mocks.search }),
  useNavigate: () => mocks.navigate,
  Navigate: () => null,
}))
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))
vi.mock('@/hooks/use-now', () => ({ useNow: () => Date.parse('2026-10-12T12:00:00Z') }))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }))
vi.mock('@/hooks/use-near-viewport', () => ({ useNearViewport: () => mocks.nearViewport }))
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    open,
    children,
    onOpenChange,
  }: {
    open: boolean
    children: ReactNode
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <div role="dialog">
        {children}
        <button onClick={() => onOpenChange(false)}>Close</button>
      </div>
    ) : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

let view: ReturnType<typeof mount> | undefined
beforeEach(() => {
  mocks.search = '?tab=accounts'
  mocks.pageStatus = 'Exhausted'
  mocks.sources = []
  mocks.leadPages = {}
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
        leads: mocks.sources.reduce((n, s) => n + s.leadsAdded, 0),
      }
    if (name === 'leads:getList')
      return (
        mocks.lists.find(
          (list) =>
            typeof args === 'object' && args && 'listId' in args && list._id === args.listId,
        ) ?? null
      )
    if (name === 'leads:lists') return mocks.lists
    if (name === 'leads:listPage') {
      const cursor = (args as { paginationOpts: { cursor: string | null } }).paginationOpts.cursor
      return mocks.leadPages[cursor ?? 'start'] ?? { page: [], isDone: true, continueCursor: '' }
    }
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
      leadsAdded: 3,
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
  expect(mocks.save).toHaveBeenCalledWith({
    listId: 'list',
    days: 7,
    monitor: true,
    postLimit: 10,
  })
  expect(usePaginatedQuery).not.toHaveBeenCalled()
  await act(async () => button('View posts').click())
  expect(view.container.querySelector('[role="dialog"]')?.textContent).toContain(
    'Posts from @example',
  )
  expect(vi.mocked(usePaginatedQuery).mock.calls.at(-1)?.[1]).toEqual({ sourceId: 'source' })
  expect(vi.mocked(usePaginatedQuery).mock.calls.at(-1)?.[2]).toEqual({ initialNumItems: 50 })
  expect(vi.mocked(useQuery).mock.calls.some(([q]) => getFunctionName(q) === 'leads:lists')).toBe(
    false,
  )
  await act(async () => button('Close').click())
  expect(view.container.querySelector('[role="dialog"]')).toBeNull()
  vi.mocked(usePaginatedQuery).mockClear()
  await typeInto(days, '8')
  expect(usePaginatedQuery).not.toHaveBeenCalled()
})

test('monitor duration is fixed and live source updates identify the active post', async () => {
  mocks.search = '?tab=sources&listId=list'
  mocks.sources = [
    {
      _id: 'source',
      username: 'example',
      enabled: true,
      running: true,
      runKind: 'likers',
      currentPostId: 'post',
      nextCheckAt: Date.now() + 86_400_000,
      lastPostsCheckAt: Date.now() - 1000,
      postCount: 1,
      leadsAdded: 3,
    },
  ]
  vi.mocked(usePaginatedQuery).mockReturnValue({
    results: [
      {
        _id: 'post',
        code: 'one',
        takenAt: Date.now(),
        likeCount: 200,
        monitoring: true,
        scheduled: true,
        nextCheckAt: Date.now() + 1000,
      },
    ],
    status: 'Exhausted',
    loadMore: mocks.loadMore,
    isLoading: false,
  })
  view = mount()
  await view.render(<ScrapeSourcesView />)
  const button = (text: string) =>
    [...view!.container.querySelectorAll('button')].find((b) => b.textContent === text)!
  const days = view.container.querySelector<HTMLInputElement>('#source-monitor-days')!
  expect(days.value).toBe('1')
  expect(days.disabled).toBe(true)
  expect(view.container.querySelector<HTMLInputElement>('#source-post-limit')!.value).toBe('10')
  expect(button('Save')).toBeUndefined()
  await act(async () => button('View posts').click())
  expect(view.container.textContent).toContain('Checking likers now')
  expect(view.container.textContent).toContain('Next discovery:')
  mocks.sources = [
    {
      ...mocks.sources[0],
      running: false,
      runKind: undefined,
      currentPostId: undefined,
      lastLikerCheckAt: Date.now(),
    },
  ]
  mocks.lists = [{ ...mocks.lists[0] }]
  await view.render(<ScrapeSourcesView />)
  expect(view.container.textContent).not.toContain('Checking likers now')
  expect(view.container.textContent).toContain('Monitoring · Next:')
  expect(view.container.textContent).toContain(
    `Last liker check: ${new Date(mocks.sources[0].lastLikerCheckAt!).toLocaleString()}`,
  )
  await view.render(<ScrapeSourcesView />)
  expect(days.value).toBe('1')
  expect(button('Save')).toBeUndefined()
  // Removing the source also unmounts its posts subscription.
  mocks.sources = []
  mocks.lists = [{ ...mocks.lists[0] }]
  await view.render(<ScrapeSourcesView />)
  expect(view.container.querySelector('[role="dialog"]')).toBeNull()
  vi.mocked(usePaginatedQuery).mockClear()
  await view.render(<ScrapeSourcesView />)
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

test('latest-post count defaults to ten and saves only on explicit Save', async () => {
  mocks.search = '?tab=sources&listId=list'
  view = mount()
  await view.render(<ScrapeSourcesView />)
  const input = view.container.querySelector<HTMLInputElement>('#source-post-limit')!
  expect(input.value).toBe('10')
  await typeInto(input, '6')
  expect(mocks.save).not.toHaveBeenCalled()
  const save = [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Save')!
  await act(async () => save.click())
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
    listId: 'list',
    days: 90,
    monitor: true,
    postLimit: 6,
  })
  mocks.lists = [{ ...mocks.lists[0], scrapePostLimit: 6 }]
  await view.render(<ScrapeSourcesView />)
  expect(input.value).toBe('6')
  expect([...view.container.querySelectorAll('button')].some((b) => b.textContent === 'Save')).toBe(
    false,
  )
})

test('lead search waits for typing to settle and pauses obsolete pagination', async () => {
  vi.useFakeTimers()
  mocks.search = '?tab=saved'
  view = mount()
  await view.render(<ScraperPage />)
  const input = view.container.querySelector<HTMLInputElement>('input[aria-label="Search leads"]')!
  for (const value of ['A', 'Al', ' Alice ']) await typeInto(input, value)
  mocks.leadPages.start = { page: [], isDone: false, continueCursor: 'next' }
  await view.render(<ScraperPage />)
  expect(mocks.loadMore).not.toHaveBeenCalled()
  expect(
    vi
      .mocked(useQuery)
      .mock.calls.filter(([query]) => getFunctionName(query) === 'leads:listPage').every(
        ([, args]) => args !== 'skip' && (!args || !('search' in args) || args.search === undefined),
      ),
  ).toBe(true)
  await act(async () => {
    vi.advanceTimersByTime(299)
  })
  expect(mocks.loadMore).not.toHaveBeenCalled()
  await act(async () => {
    vi.advanceTimersByTime(1)
  })
  expect(vi.mocked(useQuery).mock.calls.filter(([q]) => getFunctionName(q) === 'leads:listPage').at(-1)?.[1])
    .toMatchObject({ search: 'alice', paginationOpts: { cursor: 'next', numItems: 100 } })
  expect(mocks.loadMore).not.toHaveBeenCalled()
})

test('leads keep one bounded page, navigate back, and reset cursors for search', async () => {
  vi.useFakeTimers()
  mocks.search = '?tab=saved'
  const leads = (prefix: string) => Array.from({ length: 100 }, (_, i) => ({
    _id: `${prefix}${i}` as ComponentProps<typeof LeadsList>['leads'][number]['_id'],
    username: `${prefix}${i}`, createdAt: 1, dmSent: false, followed: false,
  }))
  mocks.leadPages = {
    start: { page: leads('first'), isDone: false, continueCursor: 'sparse' },
    sparse: { page: [], isDone: false, continueCursor: 'second' },
    second: { page: leads('second'), isDone: false, continueCursor: 'end' },
    end: { page: [], isDone: true, continueCursor: 'end' },
  }
  view = mount()
  await view.render(<ScraperPage />)
  const rows = () => view!.container.querySelectorAll('tbody tr')
  const button = (label: string) => view!.container.querySelector<HTMLButtonElement>(`button[aria-label="${label} page"]`)!
  expect(rows()).toHaveLength(100)
  expect(button('Previous').disabled).toBe(true)
  await act(async () => button('Next').click())
  expect(rows()).toHaveLength(100)
  expect(view.container.textContent).toContain('@second0')
  expect(view.container.textContent).not.toContain('@first0')
  expect(view.container.textContent).toContain('Page 2')
  await act(async () => button('Next').click())
  expect(view.container.textContent).toContain('No more matching accounts')
  expect(button('Next').disabled).toBe(true)
  await act(async () => button('Previous').click())
  expect(view.container.textContent).toContain('@second0')
  await act(async () => button('Previous').click())
  expect(view.container.textContent).toContain('@first0')
  await act(async () => button('Next').click())
  await typeInto(view.container.querySelector<HTMLInputElement>('input[aria-label="Search leads"]')!, 'Alice')
  expect(button('Next').disabled).toBe(true)
  await act(async () => vi.advanceTimersByTime(300))
  expect(view.container.textContent).toContain('Page 1')
  expect(button('Previous').disabled).toBe(true)
  expect(vi.mocked(useQuery).mock.calls.filter(([q]) => getFunctionName(q) === 'leads:listPage').at(-1)?.[1])
    .toMatchObject({ search: 'alice', paginationOpts: { cursor: null, numItems: 100 } })
})

for (const hasTailMatch of [false, true]) test(`refresh revisits skipped head batches with unchanged search (tail match=${hasTailMatch})`, async () => {
  vi.useFakeTimers()
  mocks.search = '?tab=saved'
  const lead = (username: string) => ({
    _id: username as ComponentProps<typeof LeadsList>['leads'][number]['_id'],
    username, createdAt: 1, dmSent: false, followed: false,
  })
  mocks.leadPages = {
    start: { page: [], isDone: false, continueCursor: 'middle' },
    middle: { page: [], isDone: false, continueCursor: 'tail' },
    tail: { page: hasTailMatch ? [lead('alice_old')] : [], isDone: true, continueCursor: 'end' },
  }
  view = mount()
  await view.render(<ScraperPage />)
  const input = view.container.querySelector<HTMLInputElement>('input[aria-label="Search leads"]')!
  await typeInto(input, 'Alice')
  await act(async () => vi.advanceTimersByTime(300))
  const previous = () => view!.container.querySelector<HTMLButtonElement>('button[aria-label="Previous page"]')!
  const lastQuery = () => vi.mocked(useQuery).mock.calls.filter(([q]) => getFunctionName(q) === 'leads:listPage').at(-1)?.[1]
  expect(lastQuery()).toMatchObject({ search: 'alice', paginationOpts: { cursor: 'tail' } })
  expect(view.container.textContent).toContain('Page 1')
  expect(previous().disabled).toBe(true)
  // A new or enriched match belongs to a range the current query no longer watches.
  mocks.leadPages.start = { page: [lead('alice_new')], isDone: false, continueCursor: 'middle' }
  await act(async () => mocks.notifyLeads())
  expect(view.container.textContent).not.toContain('@alice_new')
  await act(async () => [...view!.container.querySelectorAll('button')].find(button => button.textContent === 'Refresh leads')!.click())
  expect(lastQuery()).toMatchObject({ search: 'alice', paginationOpts: { cursor: null, numItems: 100 } })
  expect(view.container.textContent).toContain('@alice_new')
  expect(view.container.textContent).not.toContain('@alice_old')
  expect(input.value).toBe('Alice')
  expect(previous().disabled).toBe(true)
  await act(async () => view!.container.querySelector<HTMLButtonElement>('button[aria-label="Next page"]')!.click())
  expect(lastQuery()).toMatchObject({ paginationOpts: { cursor: 'tail' } })
  expect(previous().disabled).toBe(false)
  await act(async () => previous().click())
  expect(view.container.textContent).toContain('@alice_new')
})

for (const isDone of [false, true]) test(`live lead growth stays bounded without skipping overflow (isDone=${isDone})`, async () => {
  vi.useFakeTimers()
  mocks.search = '?tab=saved'
  const leads = Array.from({ length: 237 }, (_, i) => ({
    _id: `lead${i}` as ComponentProps<typeof LeadsList>['leads'][number]['_id'],
    username: `lead${i}`, createdAt: 1, dmSent: false, followed: false,
  }))
  mocks.leadPages = {
    start: { page: leads.slice(0, 100), isDone, continueCursor: 'after-live-range' },
    'after-live-range': { page: [{ ...leads[0], username: 'later' }], isDone: true, continueCursor: 'end' },
  }
  view = mount()
  await view.render(<ScraperPage />)
  const rows = () => [...view!.container.querySelectorAll('tbody tr a')].map(row => row.textContent)
  const button = (label: string) => view!.container.querySelector<HTMLButtonElement>(`button[aria-label="${label} page"]`)!
  mocks.leadPages.start = { page: leads, isDone, continueCursor: 'after-live-range' }
  await act(async () => mocks.notifyLeads())
  expect(rows()).toHaveLength(100)
  const visited = [...rows()]
  for (const size of [100, 37]) {
    expect(button('Next').disabled).toBe(false)
    await act(async () => button('Next').click())
    expect(rows()).toHaveLength(size)
    visited.push(...rows())
    expect(vi.mocked(useQuery).mock.calls.filter(([q]) => getFunctionName(q) === 'leads:listPage').at(-1)?.[1])
      .toMatchObject({ paginationOpts: { cursor: null } })
  }
  expect(visited).toEqual(leads.map(lead => `@${lead.username}`))
  expect(button('Next').disabled).toBe(isDone)
  if (!isDone) {
    await act(async () => button('Next').click())
    expect(rows()).toEqual(['@later'])
    expect(vi.mocked(useQuery).mock.calls.filter(([q]) => getFunctionName(q) === 'leads:listPage').at(-1)?.[1])
      .toMatchObject({ paginationOpts: { cursor: 'after-live-range' } })
    await act(async () => button('Previous').click())
    expect(rows()).toHaveLength(37)
  }
  await act(async () => button('Previous').click())
  expect(rows()).toEqual(leads.slice(100, 200).map(lead => `@${lead.username}`))
  // A shrinking range must not strand the user on an empty local chunk.
  mocks.leadPages.start = { page: leads.slice(0, 90), isDone, continueCursor: 'after-live-range' }
  await act(async () => mocks.notifyLeads())
  expect(rows()).toHaveLength(90)
  await typeInto(view.container.querySelector<HTMLInputElement>('input[aria-label="Search leads"]')!, 'Alice')
  await act(async () => vi.advanceTimersByTime(300))
  expect(view.container.textContent).toContain('Page 1')
  expect(button('Previous').disabled).toBe(true)
  expect(rows()).toHaveLength(90)
})

for (const startCursor of [null, 'range-start']) test(`Previous restores overflow after its server range is unsubscribed (${startCursor})`, async () => {
  mocks.search = '?tab=saved'
  const leads = Array.from({ length: 237 }, (_, i) => ({
    _id: `range${i}` as ComponentProps<typeof LeadsList>['leads'][number]['_id'],
    username: `range${i}`, createdAt: 1, dmSent: false, followed: false,
  }))
  const baseQuery = vi.mocked(useQuery).getMockImplementation()!
  let grown = false, journalLost = false, invalidBound = false
  vi.mocked(useQuery).mockImplementation((query, args?) => {
    if (getFunctionName(query) !== 'leads:listPage') return baseQuery(query, args)
    const { cursor, endCursor } = (args as { paginationOpts: { cursor: string | null; endCursor?: string } }).paginationOpts
    if (endCursor && invalidBound) return new ConvexError({ isConvexSystemError: true, paginationError: 'InvalidCursor' })
    if (startCursor !== null && cursor === null) return { page: [], isDone: false, continueCursor: startCursor }
    if (cursor === 'after-range') {
      journalLost = true
      return { page: [{ ...leads[0], username: 'later' }], isDone: true, continueCursor: 'end' }
    }
    // A resubscription starts at 100 rows unless the original boundary is supplied.
    return {
      page: grown && (!journalLost || endCursor === 'after-range') ? leads : leads.slice(0, 100),
      isDone: endCursor !== undefined,
      continueCursor: endCursor ? '_end_cursor' : 'after-range',
    }
  })
  view = mount()
  await view.render(<ScraperPage />)
  grown = true
  await act(async () => mocks.notifyLeads())
  const rows = () => [...view!.container.querySelectorAll('tbody tr a')].map(row => row.textContent)
  const button = (label: string) => view!.container.querySelector<HTMLButtonElement>(`button[aria-label="${label} page"]`)!
  for (let i = 0; i < 3; i++) await act(async () => button('Next').click())
  expect(rows()).toEqual(['@later'])
  await act(async () => button('Previous').click())
  expect(rows()).toEqual(leads.slice(200).map(lead => `@${lead.username}`))
  expect(vi.mocked(useQuery).mock.calls.filter(([q]) => getFunctionName(q) === 'leads:listPage').at(-1)?.[1])
    .toMatchObject({ paginationOpts: { cursor: startCursor, endCursor: 'after-range' } })
  expect(button('Next').disabled).toBe(false)
  await act(async () => button('Previous').click())
  expect(rows()).toEqual(leads.slice(100, 200).map(lead => `@${lead.username}`))
  await act(async () => button('Next').click())
  expect(rows()).toHaveLength(37)
  await act(async () => button('Next').click())
  expect(rows()).toEqual(['@later'])
  invalidBound = true
  await act(async () => button('Previous').click())
  expect(view.container.textContent).toContain('Page 1')
  expect(button('Previous').disabled).toBe(true)
  expect(rows()).toEqual(leads.slice(0, 100).map(lead => `@${lead.username}`))
})

for (const error of [
  new Error('InvalidCursor: query changed'),
  new ConvexError({ isConvexSystemError: true, paginationError: 'InvalidCursor' }),
]) test(`saved leads reset invalid cursors while preserving the search (${error.message})`, async () => {
  vi.useFakeTimers()
  mocks.search = '?tab=saved'
  const lead = {
    _id: 'lead' as ComponentProps<typeof LeadsList>['leads'][number]['_id'],
    username: 'alice', createdAt: 1, dmSent: false, followed: false,
  }
  mocks.leadPages = {
    start: { page: [lead], isDone: false, continueCursor: 'invalid' },
    invalid: error,
  }
  view = mount()
  await view.render(<ScraperPage />)
  const input = view.container.querySelector<HTMLInputElement>('input[aria-label="Search leads"]')!
  await typeInto(input, 'Alice')
  await act(async () => vi.advanceTimersByTime(300))
  vi.mocked(useQuery).mockClear()
  await act(async () => view!.container.querySelector<HTMLButtonElement>('button[aria-label="Next page"]')!.click())
  const calls = vi.mocked(useQuery).mock.calls.filter(([q]) => getFunctionName(q) === 'leads:listPage')
  expect(calls.some(([, args]) => (args as { paginationOpts: { cursor: string } }).paginationOpts.cursor === 'invalid')).toBe(true)
  expect(calls.at(-1)?.[1]).toMatchObject({ search: 'alice', paginationOpts: { cursor: null, numItems: 100 } })
  expect(view.container.textContent).toContain('Page 1')
  expect(view.container.textContent).toContain('@alice')
  expect(input.value).toBe('Alice')
  expect(view.container.querySelector<HTMLButtonElement>('button[aria-label="Previous page"]')!.disabled).toBe(true)
})

test('saved leads still surface unrelated query errors and invalid first-page errors', async () => {
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    for (const error of [new Error('Access denied'), new Error('InvalidCursor: invalid first page')]) {
      mocks.search = '?tab=saved'
      mocks.leadPages.start = error
      view = mount()
      await expect(view.render(<ScraperPage />)).rejects.toThrow(error.message)
      await view.unmount()
      view = undefined
    }
  } finally { report.mockRestore() }
})

test('request quota is fixed at ten per hour and shows the proxy-country schedule', async () => {
  view = mount()
  await view.render(<ScraperPage />)
  expect(view.container.textContent).toContain('Requests / hour')
  expect(view.container.textContent).toContain('0 / 10')
  expect(view.container.textContent).toContain('GB · Europe/London')
  expect(view.container.querySelector('button[aria-label="Edit scraper daily limit"]')).toBeNull()
  expect(mocks.save).not.toHaveBeenCalled()
})
