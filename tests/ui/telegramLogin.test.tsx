import { act } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { TelegramLoginPageContainer } from '@/features/auth/containers/TelegramLoginPageContainer'
import { mount } from './mount'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), login: vi.fn(), navigate: vi.fn() }))
vi.mock('@/lib/auth', () => ({ useAppAuth: () => ({
  isLoaded: true, isSignedIn: false, authFetch: mocks.fetch,
  loginWithToken: mocks.login, devLogin: vi.fn(),
}) }))
vi.mock('@/lib/router', () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [new URLSearchParams()],
  Navigate: () => null,
}))

let view: ReturnType<typeof mount> | undefined
let poll: ReturnType<typeof deferred>
let links = 0
function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>(done => { resolve = done })
  return { promise, resolve }
}
const success = () => Response.json({ user: { id: 'admin' }, token: 'session-token' })
async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(node => node.textContent?.includes(label))!
  expect(button).toBeDefined()
  await act(async () => button.click())
}
async function startPoll() {
  await click('Continue with Telegram')
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(window.location, 'href', 'set').mockImplementation(() => {})
  poll = deferred(); links = 0
  mocks.login.mockReset(); mocks.navigate.mockReset()
  mocks.fetch.mockReset().mockImplementation(async (path: string) => {
    if (path === '/api/auth/config') return Response.json({ isConfigured: true, botUsername: 'bot' })
    if (path === '/api/auth/tg-link') return Response.json({ token: `attempt-${++links}`, bot: 'bot' })
    return poll.promise
  })
})
afterEach(async () => {
  await view?.unmount(); view = undefined
  vi.useRealTimers(); vi.restoreAllMocks()
})

test.each(['cancel', 'unmount', 'replacement'] as const)('a late poll cannot sign in after %s', async action => {
  view = mount()
  await view.render(<TelegramLoginPageContainer />)
  await startPoll()
  const old = poll
  const signal = mocks.fetch.mock.calls.find(([path]) => String(path).includes('/tg-poll'))![1].signal as AbortSignal
  if (action === 'unmount') { await view.unmount(); view = undefined }
  else {
    await click('Cancel')
    if (action === 'replacement') {
      poll = deferred()
      await startPoll()
    }
  }
  expect(signal.aborted).toBe(true)
  // Model a transport that delivers a response even though abort was requested.
  await act(async () => old.resolve(success()))
  expect(mocks.login).not.toHaveBeenCalled()
  expect(mocks.navigate).not.toHaveBeenCalled()
  if (action === 'replacement') {
    await act(async () => poll.resolve(success()))
    expect(mocks.login).toHaveBeenCalledExactlyOnceWith({ id: 'admin' }, 'session-token')
    expect(mocks.navigate).toHaveBeenCalledTimes(1)
  }
})

test('slow polls never overlap and unmount prevents a late link from opening or polling', async () => {
  view = mount()
  await view.render(<TelegramLoginPageContainer />)
  await startPoll()
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
  expect(mocks.fetch.mock.calls.filter(([path]) => String(path).includes('/tg-poll'))).toHaveLength(1)
  await click('Cancel')
  const link = deferred()
  mocks.fetch.mockImplementation(() => link.promise)
  await click('Continue with Telegram')
  await view.unmount(); view = undefined
  await act(async () => link.resolve(Response.json({ token: 'late-link', bot: 'bot' })))
  await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
  expect(mocks.fetch.mock.calls.filter(([path]) => String(path).includes('/tg-poll'))).toHaveLength(1)
  expect(mocks.login).not.toHaveBeenCalled()
})
