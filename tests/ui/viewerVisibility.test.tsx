import { act } from 'react'
import { useRef } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { useViewerVisibility } from '@/features/vnc/hooks/useViewerVisibility'
import { VncPreview } from '@/features/vnc/components/VncPreview'
import { apiFetchBlob } from '@/lib/api'
import { mount } from './mount'

vi.mock('@/lib/api', () => ({ apiFetchBlob: vi.fn() }))
let view: ReturnType<typeof mount> | undefined
let notify: IntersectionObserverCallback = () => {}

function installObserver() {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        notify = callback
      }
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    },
  )
}

afterEach(async () => {
  await view?.unmount()
  view = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('viewer visibility retains brief connections and closes after the grace period', async () => {
  vi.useFakeTimers()
  installObserver()
  function Viewer() {
    const ref = useRef<HTMLDivElement>(null)
    const { enabled, visible } = useViewerVisibility(ref, 3000)
    return (
      <div ref={ref}>
        {String(visible)}:{String(enabled)}
      </div>
    )
  }
  view = mount()
  await view.render(<Viewer />)
  const target = view.container.firstElementChild!
  const change = async (visible: boolean) =>
    act(async () => {
      notify(
        [{ target, isIntersecting: visible } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })
  await change(true)
  expect(target.textContent).toBe('true:true')
  await change(false)
  await act(async () => {
    vi.advanceTimersByTime(1000)
  })
  expect(target.textContent).toBe('false:true')
  await change(true)
  await act(async () => {
    vi.advanceTimersByTime(3000)
  })
  expect(target.textContent).toBe('true:true')
  await change(false)
  await act(async () => {
    vi.advanceTimersByTime(3000)
  })
  expect(target.textContent).toBe('false:false')
})

test('VNC preview blobs and polling are released outside the viewport', async () => {
  vi.useFakeTimers()
  installObserver()
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
  vi.mocked(apiFetchBlob).mockResolvedValue(new Blob(['image']))
  view = mount()
  await view.render(<VncPreview vncPort={6081} />)
  const target = view.container.firstElementChild!
  await act(async () => {
    notify(
      [{ target, isIntersecting: true } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1001)
  })
  expect(view.container.querySelector('img')?.src).toBe('blob:preview')
  await act(async () => {
    notify(
      [{ target, isIntersecting: false } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )
  })
  expect(view.container.querySelector('img')).toBeNull()
  expect(revoke).toHaveBeenCalledWith('blob:preview')
  expect(vi.mocked(apiFetchBlob).mock.calls[0][1]?.signal?.aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})
