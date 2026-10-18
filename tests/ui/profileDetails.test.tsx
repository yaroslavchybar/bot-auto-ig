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
    getFunctionName(reference) === 'routines:setAccount' ? mocks.account
      : getFunctionName(reference) === 'profiles/mutations:setIgState' ? mocks.login : mocks.pause,
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

test('the automation profile list contains names without operational controls', async () => {
  view = mount()
  await view.render(
    <RoutineProfiles
      profiles={[
        { _id: 'one', name: 'First' },
        { _id: 'two', name: 'Second' },
      ]}
    />,
  )
  expect(view.container.textContent).toBe('FirstSecond')
  expect(view.container.querySelector('button')).toBeNull()
})
