import { act, StrictMode } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { useNow } from '@/hooks/use-now'
import { useHeaderSlot } from '@/features/chat/hooks/useHeaderSlot'
import { mount } from './mount'

let view: ReturnType<typeof mount> | undefined

afterEach(async () => {
  await view?.unmount()
  view = undefined
  document.body.replaceChildren()
  vi.useRealTimers()
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
