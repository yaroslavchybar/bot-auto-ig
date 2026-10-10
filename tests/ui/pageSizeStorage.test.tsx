import { act } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { useCursorPage, usePageSize } from '@/hooks/use-cursor-page'
import { mount } from './mount'

let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
  vi.restoreAllMocks()
  localStorage.clear()
})

function Table({ name }: { name: string }) {
  const [size, setSize] = usePageSize(name)
  const page = useCursorPage(String(size))
  return (
    <>
      <output>
        {size}:{page.pageNumber}
      </output>
      <button onClick={() => page.next('next')}>Next</button>
      <button onClick={() => setSize(25)}>25 rows</button>
    </>
  )
}

test('page size survives remounts, stays separate per table, and resets the cursor when changed', async () => {
  view = mount()
  await view.render(<Table name="profiles" />)
  expect(view.container.querySelector('output')?.textContent).toBe('50:1')
  await act(async () => view!.container.querySelectorAll('button')[0].click())
  expect(view.container.querySelector('output')?.textContent).toBe('50:2')
  await act(async () => view!.container.querySelectorAll('button')[1].click())
  expect(view.container.querySelector('output')?.textContent).toBe('25:1')
  expect(localStorage.getItem('table-page-size:profiles')).toBe('25')
  await view.unmount()
  view = mount()
  await view.render(<Table name="profiles" />)
  expect(view.container.querySelector('output')?.textContent).toBe('25:1')
  await view.render(<Table key="proxies" name="proxies" />)
  expect(view.container.querySelector('output')?.textContent).toBe('50:1')
})

test.each(['-1', '0', '500', 'invalid'])(
  'invalid stored size %s uses the default',
  async (saved) => {
    localStorage.setItem('table-page-size:profiles', saved)
    view = mount()
    await view.render(<Table name="profiles" />)
    expect(view.container.querySelector('output')?.textContent).toBe('50:1')
  },
)

test('blocked storage does not prevent loading or changing the page size', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Blocked')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Blocked')
  })
  view = mount()
  await view.render(<Table name="profiles" />)
  expect(view.container.querySelector('output')?.textContent).toBe('50:1')
  await act(async () => view!.container.querySelectorAll('button')[1].click())
  expect(view.container.querySelector('output')?.textContent).toBe('25:1')
})
