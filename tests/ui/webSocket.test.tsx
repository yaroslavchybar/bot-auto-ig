import { act } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { useWebSocket } from '@/hooks/useWebSocket'
import { mount } from './mount'

const getToken = vi.hoisted(() => vi.fn(async () => 'test-token'))
vi.mock('@/lib/auth', () => ({ useAppAuth: () => ({ getToken }) }))
vi.mock('@/lib/sentry', () => ({ addWebSocketBreadcrumb: vi.fn() }))
vi.mock('@/lib/env', () => ({ env: { apiUrl: 'http://localhost:3001' } }))

class Socket {
  static OPEN = 1
  static CONNECTING = 0
  static sockets: Socket[] = []
  readyState = Socket.CONNECTING
  onopen?: () => void
  onclose?: () => void
  onmessage?: (event: { data: string }) => void
  onerror?: () => void
  readonly url: string
  constructor(url: string) {
    this.url = url
    Socket.sockets.push(this)
  }
  open() {
    this.readyState = Socket.OPEN
    this.onopen?.()
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
}
let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
  Socket.sockets = []
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
function Probe({
  enabled = true,
  onEvent = () => {},
}: {
  enabled?: boolean
  onEvent?: (event: unknown) => void
}) {
  const socket = useWebSocket({ url: 'ws://localhost/ws', topic: 'displays', enabled, onEvent })
  return <output>{socket.connected ? 'connected' : 'disconnected'}</output>
}

test('the socket authenticates, forwards events to the current handler, and closes when disabled', async () => {
  vi.stubGlobal('WebSocket', Socket)
  const first = vi.fn(),
    next = vi.fn()
  view = mount()
  await view.render(<Probe onEvent={first} />)
  const socket = Socket.sockets[0]
  expect(new URL(socket.url).searchParams.get('token')).toBe('test-token')
  expect(new URL(socket.url).searchParams.get('topic')).toBe('displays')
  await act(async () => {
    socket.open()
  })
  expect(view.container.textContent).toBe('connected')
  await view.render(<Probe onEvent={next} />)
  await act(async () => {
    socket.onmessage?.({ data: 'invalid' })
    socket.onmessage?.({ data: JSON.stringify({ type: 'session_decision' }) })
  })
  expect(first).not.toHaveBeenCalled()
  expect(next).toHaveBeenCalledExactlyOnceWith({ type: 'session_decision' })
  expect(Socket.sockets).toHaveLength(1)
  await view.render(<Probe enabled={false} />)
  expect(socket.readyState).toBe(3)
  expect(view.container.textContent).toBe('disconnected')
})

test('unexpected disconnects reconnect, while unmount cancels pending retries', async () => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  vi.stubGlobal('WebSocket', Socket)
  view = mount()
  await view.render(<Probe />)
  await act(async () => {
    Socket.sockets[0].open()
    Socket.sockets[0].close()
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
  expect(Socket.sockets).toHaveLength(2)
  await act(async () => {
    Socket.sockets[1].close()
  })
  await view.unmount()
  view = undefined
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000)
  })
  expect(Socket.sockets).toHaveLength(2)
})

test('disabling and re-enabling during token lookup cannot create a stale socket', async () => {
  vi.stubGlobal('WebSocket', Socket)
  let finish!: (token: string) => void
  getToken.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  view = mount()
  await view.render(<Probe />)
  expect(Socket.sockets).toHaveLength(0)
  await view.render(<Probe enabled={false} />)
  await view.render(<Probe />)
  expect(Socket.sockets).toHaveLength(1)
  await act(async () => { finish('old-token') })
  expect(Socket.sockets).toHaveLength(1)
  await act(async () => { Socket.sockets[0].open() })
  expect(view.container.textContent).toBe('connected')
})
