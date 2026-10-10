import { act, type ReactNode } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { useMutation, useQuery } from 'convex/react'
import type { Doc } from '../../convex/_generated/dataModel'
import { defaultRoutine } from '../../convex/routinePolicy'
import { RoutinePopup } from '@/features/automations/components/RoutinePopup'
import { mount } from './mount'

vi.mock('convex/react', () => ({ useMutation: vi.fn(), useQuery: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => children,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

let view: ReturnType<typeof mount> | undefined
afterEach(async () => { await view?.unmount(); view = undefined })

async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent === text)!
  await act(async () => button.click())
}

async function setNumber(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

test('new automation footer names the first missing requirement', async () => {
  vi.mocked(useQuery).mockReturnValue([])
  vi.mocked(useMutation).mockReturnValue(Object.assign(vi.fn(), {
    withOptimisticUpdate: () => { throw new Error('Unexpected optimistic update') },
  }))
  view = mount()
  await view.render(<RoutinePopup onClose={() => {}} />)
  expect(document.querySelector('footer')?.textContent).toContain('Add a name')
  const create = [...document.querySelectorAll('button')].find(item => item.textContent === 'Create automation')!
  expect(create.disabled).toBe(true)
})

test('automation ranges load, reject reversed ranges, and save both min/max pairs', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  vi.mocked(useQuery).mockReturnValue([])
  vi.mocked(useMutation).mockReturnValue(Object.assign(save, {
    withOptimisticUpdate: () => { throw new Error('Unexpected optimistic update') },
  }))
  const automation = {
    _id: 'automation', _creationTime: 1, name: 'Routine', nodes: [], edges: [],
    listIds: ['model'], routine: { ...defaultRoutine, warmupMinPosts: 3, warmupMaxPosts: 6 },
    createdAt: 1, updatedAt: 1,
  } as Doc<'automations'>
  view = mount()
  await view.render(<RoutinePopup automation={automation} onClose={() => {}} />)
  await click('Warm-up')
  expect(document.querySelector<HTMLInputElement>('input[aria-label="Warm-up posts minimum"]')?.value).toBe('3')
  expect(document.querySelector<HTMLInputElement>('input[aria-label="Warm-up posts maximum"]')?.value).toBe('6')
  await setNumber('Warm-up posts minimum', '8')
  expect(document.querySelector('footer')?.textContent).toContain('min no greater than max')
  await click('Save changes')
  expect(save).not.toHaveBeenCalled()
  await setNumber('Warm-up posts minimum', '4')
  await click('Outreach')
  expect(document.querySelector<HTMLInputElement>('input[aria-label="Unfollow after minimum"]')?.value).toBe('7')
  await setNumber('Unfollow after minimum', '3')
  await setNumber('Unfollow after maximum', '6')
  await click('Save changes')
  expect(save).toHaveBeenCalledWith(expect.objectContaining({
    id: 'automation', routine: expect.objectContaining({
      warmupMinPosts: 4, warmupMaxPosts: 6, unfollowMinDays: 3, unfollowMaxDays: 6,
    }),
  }))
})
