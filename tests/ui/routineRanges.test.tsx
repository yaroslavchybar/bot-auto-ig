import { act, type ReactNode } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { useMutation, useQuery } from 'convex/react'
import type { Doc } from '../../convex/_generated/dataModel'
import { defaultRoutine } from '../../convex/routinePolicy'
import { RoutinePopup } from '@/features/automations/components/RoutinePopup'
import { mount } from './mount'
import { apiFetch } from '@/lib/api'

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
afterEach(async () => {
  await view?.unmount()
  view = undefined
})

async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent === text)!
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
  vi.mocked(useMutation).mockReturnValue(
    Object.assign(vi.fn(), {
      withOptimisticUpdate: () => {
        throw new Error('Unexpected optimistic update')
      },
    }),
  )
  view = mount()
  await view.render(<RoutinePopup onClose={() => {}} />)
  expect(document.querySelector('footer')?.textContent).toContain('Add a name')
  const create = [...document.querySelectorAll('button')].find(
    (item) => item.textContent === 'Create automation',
  )!
  expect(create.disabled).toBe(true)
})

test('an automation saves its selected lead categories and rejects an empty selection', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  vi.mocked(useQuery).mockReturnValue([])
  vi.mocked(useMutation).mockReturnValue(
    Object.assign(save, {
      withOptimisticUpdate: () => {
        throw new Error('Unused')
      },
    }),
  )
  const automation = {
    _id: 'automation',
    name: 'Routine',
    nodes: [],
    edges: [],
    listIds: ['model'],
    routine: defaultRoutine,
  } as unknown as Doc<'automations'>
  view = mount()
  await view.render(<RoutinePopup automation={automation} onClose={() => {}} />)
  await click('Outreach')
  const category = (name: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')].find(
      (button) => button.closest('label')?.textContent?.trim() === name,
    )!
  expect(category('male').getAttribute('aria-checked')).toBe('true')
  await act(async () => category('male').click())
  expect(document.querySelector('footer')?.textContent).toContain('Select at least one')
  await act(async () => {
    category('female').click()
    category('business').click()
  })
  await click('Save changes')
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      routine: expect.objectContaining({ allowedCategories: ['female', 'business'] }),
    }),
  )
})

test('automation ranges load, reject reversed ranges, and save both min/max pairs', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  vi.mocked(useQuery).mockReturnValue([])
  vi.mocked(useMutation).mockReturnValue(
    Object.assign(save, {
      withOptimisticUpdate: () => {
        throw new Error('Unexpected optimistic update')
      },
    }),
  )
  const automation = {
    _id: 'automation',
    _creationTime: 1,
    name: 'Routine',
    nodes: [],
    edges: [],
    listIds: ['model'],
    routine: { ...defaultRoutine, warmupMinPosts: 3, warmupMaxPosts: 6,
      activity: { stories_max: 99, reels_min: 99, post_view_min_seconds: 99, profile_visit_chance: 42, watch_stories: false } },
    createdAt: 1,
    updatedAt: 1,
  } as unknown as Doc<'automations'>
  view = mount()
  await view.render(<RoutinePopup automation={automation} onClose={() => {}} />)
  await click('Warm-up')
  expect(document.body.textContent).toContain('Outreach starts from day 8 with 3 posts.')
  expect(document.body.textContent).toContain('Posting continues to the 3–6 post target.')
  expect(document.body.textContent).not.toContain('posts before outreach')
  expect(
    document.querySelector<HTMLInputElement>('input[aria-label="Post target minimum"]')?.value,
  ).toBe('3')
  expect(
    document.querySelector<HTMLInputElement>('input[aria-label="Post target maximum"]')?.value,
  ).toBe('6')
  await setNumber('Post target minimum', '8')
  expect(document.querySelector('footer')?.textContent).toContain('min no greater than max')
  await click('Save changes')
  expect(save).not.toHaveBeenCalled()
  await setNumber('Post target minimum', '4')
  await click('Outreach')
  expect(
    document.querySelector<HTMLInputElement>('input[aria-label="Unfollow after minimum"]')?.value,
  ).toBe('7')
  await setNumber('Unfollow after minimum', '3')
  await setNumber('Unfollow after maximum', '6')
  await click('Save changes')
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'automation',
      routine: expect.objectContaining({
        warmupMinPosts: 4,
        warmupMaxPosts: 6,
        unfollowMinDays: 3,
        unfollowMaxDays: 6,
        activity: { watch_stories: false },
      }),
    }),
  )
})

test('Outreach settings expose gradual daily follow limits instead of DM limits', async () => {
  vi.mocked(useQuery).mockReturnValue([])
  vi.mocked(useMutation).mockReturnValue(
    Object.assign(vi.fn(), {
      withOptimisticUpdate: () => {
        throw new Error('Unexpected optimistic update')
      },
    }),
  )
  view = mount()
  await view.render(<RoutinePopup onClose={() => {}} />)
  await click('Outreach')
  expect(document.body.textContent).toContain('Daily follows')
  expect(document.body.textContent).toContain('Initial follows per day')
  expect(document.body.textContent).toContain('Max follows per day')
  expect(document.body.textContent).toContain('Notifications are checked daily')
  expect(document.body.textContent).not.toContain('Initial DMs per day')
})

test('interests add separate AI-rewritten tags, retain combinations, and save all descriptions', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  vi.mocked(useQuery).mockReturnValue([])
  vi.mocked(useMutation).mockReturnValue(Object.assign(save, { withOptimisticUpdate: () => { throw new Error('Unused') } }))
  vi.mocked(apiFetch).mockResolvedValueOnce({ description: 'Content featuring dancing or singing performances.' })
    .mockResolvedValueOnce({ description: 'Fishing techniques and angling trips.' })
  const automation = { _id: 'automation', name: 'Routine', nodes: [], edges: [], listIds: ['model'], routine: defaultRoutine } as unknown as Doc<'automations'>
  view = mount()
  await view.render(<RoutinePopup automation={automation} onClose={() => {}} />)
  await click('Interests')
  const setDraft = async (text: string) => {
    const input = document.querySelector<HTMLInputElement>('#routine-interest')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  await setDraft('dancing, singing')
  expect(document.querySelector('footer')?.textContent).toContain('Add or discard')
  await click('Add interest')
  expect(document.querySelector('ul[aria-label="Saved interests"]')?.textContent).toContain('dancing, singing')
  expect(document.querySelector('ul[aria-label="Saved interests"]')?.children.length).toBe(1)
  await setDraft('fishing content')
  await click('Add interest')
  await click('Save changes')
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ routine: expect.objectContaining({ interests: [
    { label: 'dancing, singing', description: 'Content featuring dancing or singing performances.' },
    { label: 'fishing content', description: 'Fishing techniques and angling trips.' },
  ] }) }))
})

test('an interest edit requires a new AI interpretation and failed rewriting keeps the draft', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  vi.mocked(useQuery).mockReturnValue([])
  vi.mocked(useMutation).mockReturnValue(Object.assign(save, { withOptimisticUpdate: () => { throw new Error('Unused') } }))
  vi.mocked(apiFetch).mockRejectedValueOnce(new Error('AI unavailable'))
    .mockResolvedValueOnce({ description: 'Fishing content excluding competitions.' })
  const automation = { _id: 'automation', name: 'Routine', nodes: [], edges: [], listIds: ['model'],
    routine: { ...defaultRoutine, interests: [{ label: 'fishing', description: 'Fishing content.' }] } } as unknown as Doc<'automations'>
  view = mount()
  await view.render(<RoutinePopup automation={automation} onClose={() => {}} />)
  await click('Interests')
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Edit fishing"]')!.click())
  const input = document.querySelector<HTMLInputElement>('#routine-interest')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'fishing, no competitions')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('Update interest')
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('AI unavailable')
  expect(input.value).toBe('fishing, no competitions')
  await click('Save changes')
  expect(save).not.toHaveBeenCalled()
  await click('Update interest')
  await click('Save changes')
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ routine: expect.objectContaining({ interests: [
    { label: 'fishing, no competitions', description: 'Fishing content excluding competitions.' },
  ] }) }))
})
