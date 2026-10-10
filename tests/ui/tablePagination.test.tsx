import type { ReactNode } from 'react'
import { act } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { TableCard, type TablePaginationProps } from '@/components/shared/TablePagination'
import { mount } from './mount'

const picker = vi.hoisted(() => ({
  onValueChange: undefined as undefined | ((value: string) => void),
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    onValueChange,
  }: {
    children: ReactNode
    onValueChange: (value: string) => void
  }) => {
    picker.onValueChange = onValueChange
    return <div>{children}</div>
  },
  SelectTrigger: ({ children, ...props }: { children: ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <button
      type="button"
      role="option"
      data-value={value}
      onClick={() => picker.onValueChange?.(value)}
    >
      {children}
    </button>
  ),
}))

let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
})

function pagination(overrides: Partial<TablePaginationProps> = {}): TablePaginationProps {
  return {
    pageNumber: 1,
    hasPrevious: false,
    hasNext: false,
    loading: false,
    previous: vi.fn(),
    next: vi.fn(),
    pageSize: 50,
    onPageSizeChange: vi.fn(),
    ...overrides,
  }
}

test('table footer keeps both arrows visible at the bottom, disabled when no page exists', async () => {
  view = mount()
  await view.render(
    <TableCard pagination={pagination({ hasNext: true })}>
      <p>rows</p>
    </TableCard>,
  )
  const nav = document.querySelector('nav[aria-label="Table pages"]')!
  expect(nav.parentElement?.lastElementChild).toBe(nav)
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Previous page"]')?.disabled).toBe(
    true,
  )
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Next page"]')?.disabled).toBe(
    false,
  )
})

test('rows per page picker sends the chosen size', async () => {
  const onPageSizeChange = vi.fn()
  view = mount()
  await view.render(
    <TableCard pagination={pagination({ onPageSizeChange })}>
      <p>rows</p>
    </TableCard>,
  )
  const option = document.querySelector<HTMLButtonElement>('[role="option"][data-value="25"]')!
  await act(async () => option.click())
  expect(onPageSizeChange).toHaveBeenCalledWith(25)
})

test('footer hides the picker when no page size is passed', async () => {
  view = mount()
  await view.render(
    <TableCard
      pagination={{
        pageNumber: 2,
        hasPrevious: true,
        hasNext: false,
        loading: false,
        previous: vi.fn(),
        next: vi.fn(),
      }}
    >
      <p>rows</p>
    </TableCard>,
  )
  expect(document.querySelector('[role="option"]')).toBeNull()
  expect(document.querySelector('nav')?.textContent).toContain('Page 2')
})
