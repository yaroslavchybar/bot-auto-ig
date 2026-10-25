import { act, useLayoutEffect } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { useProfilesPage } from '@/features/profiles/hooks/useProfilesPage'
import { mount } from './mount'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  apiFetch: vi.fn().mockResolvedValue({}),
  handleError: vi.fn(),
}))
vi.mock('convex/react', () => ({
  useConvex: () => ({ query: mocks.query }),
  useQuery: () => ({ page: [], isDone: true, continueCursor: '' }),
}))
vi.mock('@/lib/api', () => ({ apiFetch: mocks.apiFetch }))
vi.mock('@/hooks/useErrorHandler', () => ({ useErrorHandler: () => ({ handleError: mocks.handleError }) }))
let state: ReturnType<typeof useProfilesPage>
function Probe() {
  const value = useProfilesPage()
  useLayoutEffect(() => {
    state = value
  }, [value])
  return <output>{value.editProfile?.name ?? 'none'}</output>
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  mocks.query.mockReset()
  mocks.apiFetch.mockReset().mockResolvedValue({})
  mocks.handleError.mockReset()
})

test('older edit responses cannot replace a newer selected profile', async () => {
  const first = deferred<object>(),
    second = deferred<object>()
  mocks.query.mockImplementation((_api, { profileId }) =>
    profileId === 'A' ? first.promise : second.promise,
  )
  view = mount()
  await view.render(<Probe />)
  let pA!: Promise<void>, pB!: Promise<void>
  await act(async () => {
    pA = state.handleEdit({ id: 'A', name: 'A' })
  })
  await act(async () => {
    pB = state.handleEdit({ id: 'B', name: 'B' })
  })
  await act(async () => {
    second.resolve({ _id: 'B', name: 'B' })
    await pB
  })
  expect(state.editProfile?.id).toBe('B')
  expect(state.saving).toBe(false)
  await act(async () => {
    first.resolve({ _id: 'A', name: 'A' })
    await pA
  })
  expect(state.editProfile?.id).toBe('B')
  expect(state.saving).toBe(false)
})

test('an old save cannot close a newer profile editor', async () => {
  mocks.query.mockImplementation((_api, args) =>
    args.profileId
      ? Promise.resolve({ _id: args.profileId, name: args.profileId })
      : Promise.resolve({}),
  )
  const saving = deferred<object>()
  mocks.apiFetch.mockImplementation((path) =>
    path === '/api/profiles/A' ? saving.promise : Promise.resolve({}),
  )
  view = mount()
  await view.render(<Probe />)
  await act(async () => {
    await state.handleEdit({ id: 'A', name: 'A' })
  })
  let pSave!: Promise<void>
  await act(async () => {
    pSave = state.handleSaveProfile({ name: 'A' })
  })
  await act(async () => {
    state.handleCloseEdit()
  })
  await act(async () => {
    await state.handleEdit({ id: 'B', name: 'B' })
  })
  expect(state.editProfile?.id).toBe('B')
  expect(state.saving).toBe(false)
  await act(async () => {
    saving.resolve({})
    await pSave
  })
  expect(state.editProfile?.id).toBe('B')
  expect(state.saving).toBe(false)
})

test('an old save cannot clear the pending state of a newer save', async () => {
  mocks.query.mockImplementation((_api, args) =>
    args.profileId
      ? Promise.resolve({ _id: args.profileId, name: args.profileId })
      : Promise.resolve({}),
  )
  const first = deferred<object>(),
    second = deferred<object>()
  mocks.apiFetch.mockImplementation((path) =>
    path === '/api/profiles/A'
      ? first.promise
      : path === '/api/profiles/B'
        ? second.promise
        : Promise.resolve({}),
  )
  view = mount()
  await view.render(<Probe />)
  await act(async () => {
    await state.handleEdit({ id: 'A', name: 'A' })
  })
  let saveA!: Promise<void>, saveB!: Promise<void>
  await act(async () => {
    saveA = state.handleSaveProfile({ name: 'A' })
    state.handleCloseEdit()
  })
  await act(async () => {
    await state.handleEdit({ id: 'B', name: 'B' })
  })
  await act(async () => {
    saveB = state.handleSaveProfile({ name: 'B' })
  })
  await act(async () => {
    first.resolve({})
    await saveA
  })
  expect(state.editProfile?.id).toBe('B')
  expect(state.saving).toBe(true)
  await act(async () => {
    second.resolve({})
    await saveB
  })
  expect(state.editProfile).toBeNull()
  expect(state.saving).toBe(false)
})

test('closing or opening Create invalidates pending profile loads', async () => {
  const pending = deferred<object>()
  mocks.query.mockReturnValue(pending.promise)
  view = mount()
  await view.render(<Probe />)
  let loading!: Promise<void>
  await act(async () => {
    loading = state.handleEdit({ id: 'A', name: 'A' })
  })
  await act(async () => {
    state.handleCreate()
  })
  await act(async () => {
    pending.resolve({ _id: 'A', name: 'A' })
    await loading
  })
  expect(state.editProfile).toBeNull()
  expect(state.isCreateOpen).toBe(true)
})

test.each([false, true])('browser actions are guarded per profile, including before rerender (inUse=%s)', async inUse => {
  const first = deferred<object>(), second = deferred<object>()
  mocks.apiFetch.mockImplementation(path => path.includes('/A/') ? first.promise : second.promise)
  view = mount()
  await view.render(<Probe />)
  mocks.apiFetch.mockClear() // Ignore the mount's runtime reconciliation request.
  let a!: Promise<void>, b!: Promise<void>
  await act(async () => {
    a = state.toggleUsing({ id: 'A', name: 'A', inUse })
    void state.toggleUsing({ id: 'A', name: 'A', inUse })
    b = state.toggleUsing({ id: 'B', name: 'B', inUse })
  })
  expect(mocks.apiFetch.mock.calls.map(([path]) => path)).toEqual([
    `/api/profiles/A/${inUse ? 'stop' : 'start'}`,
    `/api/profiles/B/${inUse ? 'stop' : 'start'}`,
  ])
  expect([...state.pendingProfileIds]).toEqual(['A', 'B'])
  await act(async () => { first.resolve({}); await a })
  expect([...state.pendingProfileIds]).toEqual(['B'])
  await act(async () => { second.resolve({}); await b })
  expect(state.pendingProfileIds.size).toBe(0)
  expect(state.saving).toBe(false)
})

test.each([false, true])('failed browser actions show an error and permit another attempt (inUse=%s)', async inUse => {
  view = mount()
  await view.render(<Probe />)
  const error = new Error('Browser operation rejected')
  mocks.apiFetch.mockClear().mockRejectedValueOnce(error).mockResolvedValue({})
  const profile = { id: 'A', name: 'A', inUse }
  await act(async () => { await state.toggleUsing(profile) })
  expect(mocks.handleError).toHaveBeenCalledWith(error, 'Toggle profile')
  expect(state.pendingProfileIds.size).toBe(0)
  expect(state.saving).toBe(false)
  await act(async () => { await state.toggleUsing(profile) })
  expect(mocks.apiFetch).toHaveBeenCalledTimes(2)
})
