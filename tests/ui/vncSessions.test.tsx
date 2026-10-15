import { act } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { VncSessionsProvider, useVncSessions } from '@/features/vnc/hooks/useVncSessions'
import { apiFetch } from '@/lib/api'
import { mount } from './mount'
import { SessionDecisionBadge } from '@/features/vnc/components/SessionDecisionBadge'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }))
const socket = vi.hoisted(() => ({ connected: false, onEvent: (_event: unknown) => {} }))
vi.mock('@/hooks/useWebSocket', () => ({ useWebSocket: ({ onEvent }: { onEvent: (event: unknown) => void }) => {
  socket.onEvent = onEvent
  return { connected: socket.connected }
} }))
vi.mock('@/hooks/useErrorHandler', () => {
  const handleError = vi.fn()
  return { useErrorHandler: () => ({ handleError }) }
})
let view: ReturnType<typeof mount> | undefined

test('live badges show Interest confidence and label profile categories as AI results', async () => {
  view = mount()
  await view.render(<SessionDecisionBadge decision={{ kind: 'interest', status: 'complete', confidence: 0.876, related: true }} />)
  expect(view.container.textContent).toBe('Interest 88%')
  await view.render(<SessionDecisionBadge decision={{ kind: 'profile', status: 'complete', username: 'lead', category: 'male', confidence: 0.92 }} />)
  expect(view.container.textContent).toBe('AI: Male 92%')
  expect(view.container.querySelector('[role="status"]')?.getAttribute('title')).toContain('@lead')
  await view.render(<SessionDecisionBadge decision={{ kind: 'profile', status: 'checking', username: 'lead' }} />)
  expect(view.container.textContent).toBe('Screening profile…')
  await view.render(<SessionDecisionBadge decision={null} />)
  expect(view.container.textContent).toBe('')
})
afterEach(async () => {
  await view?.unmount()
  view = undefined
  socket.connected = false
  vi.useRealTimers()
})

test('disconnect clears scores immediately and polling or reconnection cannot restore them', async () => {
  vi.useFakeTimers()
  socket.connected = true
  const display = { id: 'lease', automationId: 'automation', profileName: 'profile', vncPort: 6081, displayNum: 100, status: 'active' }
  vi.mocked(apiFetch).mockResolvedValue([display])
  function Decision() {
    return <SessionDecisionBadge decision={useVncSessions().sessions[0]?.decision} />
  }
  view = mount()
  const render = () => view!.render(<VncSessionsProvider><Decision /></VncSessionsProvider>)
  await render()
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  const event = { type: 'session_decision', displayId: 'lease', automationId: 'automation', profileName: 'profile',
    decision: { kind: 'interest', status: 'complete', confidence: 0.87, related: true } }
  await act(async () => { socket.onEvent(event) })
  expect(view.container.textContent).toBe('Interest 87%')

  let finishPoll!: (value: unknown) => void
  vi.mocked(apiFetch).mockImplementationOnce(() => new Promise(resolve => { finishPoll = resolve }))
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
  socket.connected = false
  await render()
  expect(view.container.textContent).toBe('')
  await act(async () => { finishPoll([display]) })
  await act(async () => { await vi.advanceTimersByTimeAsync(5001) })
  expect(view.container.textContent).toBe('')

  socket.connected = true
  await render()
  expect(view.container.textContent).toBe('')
  await act(async () => { socket.onEvent({ ...event, decision: { ...event.decision, confidence: 0.95 } }) })
  expect(view.container.textContent).toBe('Interest 95%')
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
