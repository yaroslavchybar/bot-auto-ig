import { act } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { getFunctionName } from 'convex/server'
import type { FunctionReference, FunctionReturnType } from 'convex/server'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { ProfileDetailsDialog } from '@/features/profiles/components/ProfileDetailsDialog'
import { RoutineProfiles } from '@/features/automations/components/RoutineProfiles'
import { mount } from './mount'

const mocks = vi.hoisted(() => ({
  details: undefined as unknown,
  pause: vi.fn(),
  account: vi.fn(),
  login: vi.fn(),
  request: vi.fn(),
}))
vi.mock('convex/react', () => ({
  useQuery: () => mocks.details,
  useMutation: (reference: FunctionReference<'mutation'>) =>
    getFunctionName(reference) === 'routines:setAccount'
      ? mocks.account
      : getFunctionName(reference) === 'profiles/mutations:setIgState'
        ? mocks.login
        : mocks.pause,
}))
vi.mock('@/lib/api', () => ({ apiFetch: mocks.request }))
const profile = { id: 'profile', name: 'Example' }
const details: NonNullable<FunctionReturnType<typeof api.routines.profileDetails>> = {
  profileId: 'profile' as Id<'profiles'>,
  name: 'Example',
  paused: false,
  issue: 'Delivery needs review',
  stage: 'Outreach',
  activeDays: 22,
  used: 2,
  allowance: 10,
  sent: 1,
  followed: 1,
  budgetExhausted: false,
  dailyBudget: null,
  nextRunAt: 0,
  browserStatus: 'idle',
  igLoggedIn: true,
  changing: false,
  model: { name: 'Model A' },
  automation: { name: 'Automation A', enabled: true, status: 'cancelled' },
  setup: {
    usernameDone: true,
    fullNameDone: true,
    avatarDone: true,
    postsDone: 3,
    postTarget: 3,
    pending: { kind: 'post', date: '2026-10-18' },
    error: 'Check the post',
  },
}
let view: ReturnType<typeof mount> | undefined
const originalConfirm = window.confirm
const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (node) => node.textContent === name,
  )!
afterEach(async () => {
  await view?.unmount()
  view = undefined
  window.confirm = originalConfirm
  vi.restoreAllMocks()
})

test('profile details retain pause, resume, issue resolution, and setup review controls', async () => {
  mocks.details = details
  mocks.pause.mockResolvedValue(undefined)
  mocks.account.mockResolvedValue(undefined)
  mocks.request.mockResolvedValue({})
  view = mount()
  await view.render(<ProfileDetailsDialog profile={profile} onClose={() => {}} />)
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.textContent).toContain('Model A')
  expect(dialog.textContent).toContain('Outreach 2/10')
  expect(dialog.textContent).toContain('Delivery needs review')
  expect(dialog.textContent).toContain('Check the post')
  await act(async () => button('Pause profile').click())
  expect(mocks.pause).toHaveBeenLastCalledWith({ profileId: 'profile', paused: true })
  mocks.details = { ...details, paused: true }
  await view.render(<ProfileDetailsDialog profile={profile} onClose={() => {}} />)
  await act(async () => button('Resume profile').click())
  expect(mocks.pause).toHaveBeenLastCalledWith({ profileId: 'profile', paused: false })
  await act(async () => button('Mark resolved').click())
  expect(mocks.account).toHaveBeenCalledWith({ profileId: 'profile', clearIssue: true })
  await act(async () => button('Succeeded').click())
  expect(mocks.request).toHaveBeenLastCalledWith('/api/ig-accounts/warmup/profile/reconcile', {
    method: 'POST',
    body: { resolution: 'completed' },
  })
  const confirm = vi.fn().mockReturnValue(false)
  window.confirm = confirm
  mocks.request.mockClear()
  await act(async () => button('Failed, retry').click())
  expect(confirm).toHaveBeenCalled()
  expect(mocks.request).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  await act(async () => button('Failed, retry').click())
  expect(mocks.request).toHaveBeenLastCalledWith('/api/ig-accounts/warmup/profile/reconcile', {
    method: 'POST',
    body: { resolution: 'failed' },
  })
})

test('profile details handle loading, deleted profiles and unavailable setup', async () => {
  mocks.details = undefined
  view = mount()
  await view.render(<ProfileDetailsDialog profile={profile} onClose={() => {}} />)
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    'Loading profile details',
  )
  mocks.details = null
  await view.render(<ProfileDetailsDialog profile={profile} onClose={() => {}} />)
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('no longer exists')
  mocks.details = { ...details, model: null, automation: null, setup: null }
  await view.render(<ProfileDetailsDialog profile={profile} onClose={() => {}} />)
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Setup has not started')
})

test('login can be changed inside profile details and is disabled during profile changes', async () => {
  mocks.details = details
  mocks.login.mockResolvedValue(undefined)
  view = mount()
  await view.render(<ProfileDetailsDialog profile={profile} onClose={() => {}} />)
  const toggle = () => document.querySelector<HTMLButtonElement>('[role="dialog"] [role="switch"]')!
  expect(toggle().getAttribute('aria-checked')).toBe('true')
  await act(async () => toggle().click())
  expect(mocks.login).toHaveBeenCalledWith({ profileId: 'profile', igLoggedIn: false })
  mocks.details = { ...details, igLoggedIn: false, changing: true }
  await view.render(<ProfileDetailsDialog profile={profile} onClose={() => {}} />)
  expect(toggle().getAttribute('aria-checked')).toBe('false')
  expect(toggle().disabled).toBe(true)
})

test('the automation profile list shows daily minutes and next runs without operational controls', async () => {
  const now = Date.UTC(2026, 9, 20, 12)
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const budget = { date: '2026-10-20', total: 30, remaining: 12.5, running: false }
  view = mount()
  await view.render(
    <RoutineProfiles
      enabled
      profiles={[
        {
          ...details,
          name: 'First',
          issue: undefined,
          dailyBudget: budget,
          nextRunAt: now + 60_000,
        },
        {
          ...details,
          profileId: 'two' as Id<'profiles'>,
          name: 'Second',
          dailyBudget: { ...budget, remaining: 0 },
        },
        {
          ...details,
          profileId: 'three' as Id<'profiles'>,
          name: 'Third',
          dailyBudget: { ...budget, date: '2026-10-19' },
        },
        {
          ...details,
          profileId: 'four' as Id<'profiles'>,
          name: 'Fourth',
          dailyBudget: { ...budget, running: true },
        },
      ]}
    />,
  )
  const rows = view.container.querySelectorAll('li')
  expect(rows[0].textContent).toContain('30 min budget · 12.5 min left')
  expect(rows[0].textContent).toContain(
    `Next run: ${new Date(now + 60_000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
  )
  expect(rows[1].textContent).toContain('0 min left')
  expect(rows[1].textContent).not.toContain('Next run:')
  expect(rows[2].textContent).toContain("Today's budget not planned yet")
  expect(rows[2].textContent).not.toContain('Next run:')
  expect(rows[3].textContent).toContain('Session running')
  expect(rows[3].textContent).not.toContain('Next run:')
  expect(view.container.textContent).not.toContain('DM')
  expect(view.container.textContent).not.toContain('follow')
  expect(view.container.querySelector('button')).toBeNull()
})

test('next runs respect disabled, paused, attention and tomorrow schedules', async () => {
  const now = Date.UTC(2026, 9, 20, 12)
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const profile = {
    ...details,
    issue: undefined,
    dailyBudget: { date: '2026-10-20', total: 30, remaining: 20, running: false },
  }
  view = mount()
  for (const [overrides, expected] of [
    [{}, 'Due now'],
    [{ paused: true }, 'Paused'],
    [{ issue: 'Review' }, 'Needs attention'],
    [{ stage: 'Not logged in' }, 'Not logged in'],
    [{ nextRunAt: Date.UTC(2026, 9, 21) }, 'Not scheduled today'],
  ] as const) {
    await view.render(<RoutineProfiles enabled profiles={[{ ...profile, ...overrides }]} />)
    expect(view.container.textContent).toContain(`Next run: ${expected}`)
  }
  await view.render(<RoutineProfiles enabled={false} profiles={[profile]} />)
  expect(view.container.textContent).toContain('Next run: Automation off')
})
