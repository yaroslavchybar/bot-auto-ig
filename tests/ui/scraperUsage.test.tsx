import { act, type ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { getFunctionName } from 'convex/server'
import { usePaginatedQuery, useQuery } from 'convex/react'
import { ScraperPage } from '@/features/scraper/ScraperPage'
import { mount } from './mount'

const mocks = vi.hoisted(() => ({
  search: '?tab=accounts',
  accounts: [{ id: 'profile', name: 'scraper', ready: true, dailyLimit: 1000, used: 0 }],
  lists: [{ _id: 'list', name: 'Purpose', createdAt: 0 }],
  jobs: [],
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
}))
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))
vi.mock('@/hooks/use-now', () => ({ useNow: () => 0 }))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }))
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
  mocks.save.mockResolvedValue(undefined)
  vi.mocked(useQuery).mockImplementation((query, args?) => {
    if (args === 'skip') return undefined
    const name = getFunctionName(query)
    if (name === 'scraper:accounts') return mocks.accounts
    if (name === 'scraper:jobs') return mocks.jobs
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

test('the closed job dialog skips list subscriptions and inactive tabs have no queries', async () => {
  view = mount()
  await view.render(<ScraperPage />)
  expect(
    vi
      .mocked(useQuery)
      .mock.calls.filter(([query]) => getFunctionName(query) === 'leads:lists')
      .every(([, args]) => args === 'skip'),
  ).toBe(true)
  expect(
    vi.mocked(useQuery).mock.calls.some(([query]) => getFunctionName(query) === 'scraper:jobs'),
  ).toBe(false)
  expect(usePaginatedQuery).not.toHaveBeenCalled()

  vi.mocked(useQuery).mockClear()
  mocks.search = '?tab=jobs'
  await view.render(<ScraperPage />)
  expect(
    vi.mocked(useQuery).mock.calls.some(([query]) => getFunctionName(query) === 'scraper:accounts'),
  ).toBe(false)
  const open = [...view.container.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('New job'),
  )!
  await act(async () => open.click())
  expect(
    vi
      .mocked(useQuery)
      .mock.calls.some(
        ([query, args]) => getFunctionName(query) === 'leads:lists' && args !== 'skip',
      ),
  ).toBe(true)
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
