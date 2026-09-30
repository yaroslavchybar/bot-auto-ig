import { act, StrictMode } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { useNow } from '@/hooks/use-now'
import { useHeaderSlot } from '@/features/chat/hooks/useHeaderSlot'
import { useDocumentVisibility } from '@/hooks/use-document-visibility'
import { mount } from './mount'

let view: ReturnType<typeof mount> | undefined

afterEach(async () => {
  await view?.unmount()
  view = undefined
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('visibility consumers share one browser listener and release it on unmount', async () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const add = vi.spyOn(document, 'addEventListener')
  const remove = vi.spyOn(document, 'removeEventListener')
  function Visible() {
    return <output>{useDocumentVisibility() ? 'visible' : 'hidden'}</output>
  }
  view = mount()
  await view.render(
    <StrictMode>
      <Visible />
      <Visible />
    </StrictMode>,
  )
  expect(view.container.textContent).toBe('visiblevisible')
  const added = () => add.mock.calls.filter(([event]) => event === 'visibilitychange').length
  const removed = () => remove.mock.calls.filter(([event]) => event === 'visibilitychange').length
  expect(added() - removed()).toBe(1)
  await act(async () => {
    visibility.mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(view.container.textContent).toBe('hiddenhidden')
  await view.render(
    <StrictMode>
      <Visible />
    </StrictMode>,
  )
  expect(added() - removed()).toBe(1)
  await view.unmount()
  view = undefined
  expect(added()).toBe(removed())
})

test('clock updates with time and cancels its timer on unmount', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(10_000)
  function Clock() {
    return <output>{useNow(1000)}</output>
  }
  view = mount()
  await view.render(
    <StrictMode>
      <Clock />
    </StrictMode>,
  )
  expect(view.container.textContent).toBe('10000')
  await act(async () => {
    vi.advanceTimersByTime(1000)
  })
  expect(view.container.textContent).toBe('11000')
  await view.unmount()
  view = undefined
  expect(vi.getTimerCount()).toBe(0)
})

test('many clocks share one timer, pause while hidden, and stop after cooldowns expire', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(20_000)
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  function Clock() {
    return <output>{useNow(500, 22_000)}</output>
  }
  view = mount()
  await view.render(
    <>
      {Array.from({ length: 100 }, (_, i) => (
        <Clock key={i} />
      ))}
    </>,
  )
  expect(vi.getTimerCount()).toBe(1)
  await act(async () => {
    hidden.mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(vi.getTimerCount()).toBe(0)
  vi.setSystemTime(21_000)
  await act(async () => {
    hidden.mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(view.container.querySelector('output')?.textContent).toBe('21000')
  expect(vi.getTimerCount()).toBe(1)
  await act(async () => {
    vi.advanceTimersByTime(1000)
  })
  expect(vi.getTimerCount()).toBe(0)
  expect(view.container.querySelector('output')?.textContent).toBe('22000')
})

test('header subscription tracks slots appearing, changing identity, and disappearing', async () => {
  function Header({ id }: { id: string }) {
    const slot = useHeaderSlot(id)
    return <output>{slot?.id ?? 'missing'}</output>
  }
  view = mount()
  await view.render(
    <StrictMode>
      <Header id="first-slot" />
    </StrictMode>,
  )
  expect(view.container.textContent).toBe('missing')
  const slot = document.createElement('div')
  slot.id = 'first-slot'
  await act(async () => {
    document.body.append(slot)
  })
  expect(view.container.textContent).toBe('first-slot')
  await act(async () => {
    slot.id = 'second-slot'
  })
  expect(view.container.textContent).toBe('missing')
  await view.render(
    <StrictMode>
      <Header id="second-slot" />
    </StrictMode>,
  )
  expect(view.container.textContent).toBe('second-slot')
  await act(async () => {
    slot.remove()
  })
  expect(view.container.textContent).toBe('missing')
})
