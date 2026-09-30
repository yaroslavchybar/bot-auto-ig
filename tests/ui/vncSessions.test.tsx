import { act } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { VncSessionsProvider, useVncSessions } from '@/features/vnc/hooks/useVncSessions'
import { apiFetch } from '@/lib/api'
import { mount } from './mount'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }))
vi.mock('@/hooks/useWebSocket', () => ({ useWebSocket: () => ({ connected: false }) }))
vi.mock('@/hooks/useErrorHandler', () => {
  const handleError = vi.fn()
  return { useErrorHandler: () => ({ handleError }) }
})
let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
  vi.useRealTimers()
})

test('header and grid share one session fetch and poll loop', async () => {
  vi.useFakeTimers()
  vi.mocked(apiFetch).mockResolvedValue([])
  function Consumer() {
    return <output>{useVncSessions().sessions.length}</output>
  }
  view = mount()
  await view.render(
    <VncSessionsProvider>
      <Consumer />
      <Consumer />
    </VncSessionsProvider>,
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(apiFetch).toHaveBeenCalledTimes(1)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000)
  })
  expect(apiFetch).toHaveBeenCalledTimes(2)
  await view.unmount()
  view = undefined
  expect(vi.getTimerCount()).toBe(0)
})
