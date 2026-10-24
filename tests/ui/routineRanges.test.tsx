import { act, type ReactNode } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { useMutation, useQuery } from 'convex/react'
import type { Doc } from '../../convex/_generated/dataModel'
import { defaultRoutine } from '../../convex/routinePolicy'
import { RoutinePopup } from '@/features/automations/components/RoutinePopup'
import { mount } from './mount'
import { apiFetch } from '@/lib/api'
import { DEFAULT_SCREENING_SETTINGS } from '../../server/shared/aiSettings'

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

test('warm-up editor shows default schedules and saves changed browsing settings', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  vi.mocked(useQuery).mockReturnValue([])
  vi.mocked(useMutation).mockReturnValue(Object.assign(save, {
    withOptimisticUpdate: () => { throw new Error('Unused') },
  }))
  const automation = { _id: 'automation', name: 'Routine', modelIds: ['model'],
    routine: { ...defaultRoutine, activity: {} } } as unknown as Doc<'automations'>
  view = mount()
  await view.render(<RoutinePopup automation={automation} onClose={() => {}} />)
  await click('Warm-up')
  for (const [label, min, max] of [
    ['Daily browsing', '10', '20'], ['Session length', '5', '10'],
    ['Rest between sessions', '60', '120'],
  ]) {
    expect(document.querySelector<HTMLInputElement>(`input[aria-label="${label} minimum"]`)?.value).toBe(min)
    expect(document.querySelector<HTMLInputElement>(`input[aria-label="${label} maximum"]`)?.value).toBe(max)
  }
  const toggle = (text: string) => [...document.querySelectorAll('label')]
    .find(element => element.textContent === text)!.querySelector<HTMLButtonElement>('[role="switch"]')!
  expect(toggle('Home feed').getAttribute('aria-checked')).toBe('true')
  expect(toggle('Reels scroll').getAttribute('aria-checked')).toBe('true')
  await click('Stories')
  expect(toggle('Watch stories before feed').getAttribute('aria-checked')).toBe('true')
  await setNumber('Daily browsing minimum', '15')
  await act(async () => toggle('Home feed').click())
  await click('Save changes')
  expect(save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    routine: expect.objectContaining({ activity: {
      warmup_min_minutes: 15, warmup_max_minutes: 20, browse_home_feed: false,
    } }),
  }))
})

test('the AI tab loads saved settings, edits a prompt, validates it, and saves with the automation', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  vi.mocked(useQuery).mockReturnValue([])
  vi.mocked(useMutation).mockReturnValue(Object.assign(save, { withOptimisticUpdate: () => { throw new Error('Unused') } }))
  const ai = { interestMatch: { model: 'liquid/d1-ultra', prompt: 'Fishing content.' } }
  const automation = { _id: 'automation', name: 'Routine', modelIds: ['model'],
    routine: { ...defaultRoutine, ai } } as unknown as Doc<'automations'>
  view = mount()
  await view.render(<RoutinePopup automation={automation} onClose={() => {}} />)
  await click('AI settings')
  expect(document.querySelector('[role="tablist"][aria-label="AI settings steps"]')?.children.length).toBe(3)
  await click('Interest matching')
  const input = document.querySelector<HTMLTextAreaElement>('#ai-interestMatch-prompt')!
  expect(input.value).toBe('Fishing content.')
  expect(document.querySelector('#ai-interestMatch-model')?.textContent).toContain('liquid/d1-ultra')
  expect(document.querySelector<HTMLTextAreaElement>('#ai-profile-state')?.readOnly).toBe(false)
  await act(async () => document.querySelector('#ai-interestMatch-model')!.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
  ))
  const option = [...document.querySelectorAll('[role="option"]')].find(node => node.textContent === 'respan/span-02')!
  await act(async () => option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(document.querySelector('#ai-interestMatch-model')?.textContent).toContain('respan/span-02')
  const edit = async (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await edit(' ')
  expect(document.querySelector('footer')?.textContent).toContain('AI prompts must be')
  await edit('Fishing techniques and catches only.')
  await click('Person detection')
  expect(document.querySelector<HTMLElement>('#ai-interestMatch-prompt')?.closest('section')?.hidden).toBe(true)
  await click('Interest matching')
  expect(document.querySelector<HTMLTextAreaElement>('#ai-interestMatch-prompt')?.value).toBe('Fishing techniques and catches only.')
  await click('Save changes')
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ routine: expect.objectContaining({
    ai: { interestMatch: { model: 'respan/span-02', prompt: 'Fishing techniques and catches only.' } },
  }) }))
})

test('profile screening prompts and both models are editable and saved', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  vi.mocked(useQuery).mockReturnValue([])
  vi.mocked(useMutation).mockReturnValue(
    Object.assign(save, { withOptimisticUpdate: () => { throw new Error('Unused') } }),
  )
  const automation = { _id: 'automation', name: 'Routine', modelIds: ['model'],
    routine: defaultRoutine } as unknown as Doc<'automations'>
  view = mount()
  await view.render(<RoutinePopup automation={automation} onClose={() => {}} />)
  await click('AI settings')
  expect(document.querySelector('#ai-profile-model')?.textContent).toContain('liquid/d1-ultra')
  expect(document.querySelector('#ai-profile-follow-model')?.textContent).toContain('liquid/d1-ultra')
  expect(document.querySelector('#ai-profile-non-english-text')).not.toBeNull()
  expect(document.querySelector('#ai-profile-lives-western-country')).toBeNull()
  const pick = async (id: string, model: string) => {
    await act(async () =>
      document.querySelector<HTMLElement>(`#${id}`)!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      ),
    )
    const option = [...document.querySelectorAll('[role="option"]')].find(
      (node) => node.textContent === model,
    )!
    await act(async () => option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  }
  await pick('ai-profile-model', 'typesafe/jev-1.14')
  await pick('ai-profile-follow-model', 'respan/span-02')
  expect(document.querySelector('#ai-profile-model')?.textContent).toContain('typesafe/jev-1.14')
  expect(document.querySelector('#ai-profile-follow-model')?.textContent).toContain('respan/span-02')
  const criteria = document.querySelector<HTMLTextAreaElement>('#ai-profile-criteria-male')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(criteria, ' ')
    criteria.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(document.querySelector('footer')?.textContent).toContain('male prompt must be')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(criteria, 'Only accounts presenting as men.')
    criteria.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('Save changes')
  expect(save).toHaveBeenCalledWith(expect.objectContaining({
    routine: expect.objectContaining({
      ai: { profileScreening: {
        model: 'typesafe/jev-1.14',
        followModel: 'respan/span-02',
        criteria: { male: 'Only accounts presenting as men.' },
      } },
    }),
  }))
})

test('profile screening Reset restores all defaults and preserves other AI settings when saved', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  vi.mocked(useQuery).mockReturnValue([])
  vi.mocked(useMutation).mockReturnValue(
    Object.assign(save, { withOptimisticUpdate: () => { throw new Error('Unused') } }),
  )
  const interestMatch = { model: 'liquid/d1-ultra', prompt: 'Fishing content.' }
  const profileScreening = {
    model: 'typesafe/jev-1.14',
    followModel: 'respan/span-02',
    state: 'Custom screenshot instructions.',
    instructions: 'Custom category question.',
    criteria: { male: 'Custom first choice.', female: 'Custom second choice.', business: 'Custom third choice.' },
    nonEnglishText: 'Custom non-English text check.',
  }
  const automation = { _id: 'automation', name: 'Routine', modelIds: ['model'],
    routine: { ...defaultRoutine, ai: { profileScreening, interestMatch } } } as unknown as Doc<'automations'>
  view = mount()
  await view.render(<RoutinePopup automation={automation} onClose={() => {}} />)
  await click('AI settings')
  expect(document.querySelector<HTMLTextAreaElement>('#ai-profile-state')?.value).toBe(profileScreening.state)
  await click('Reset')
  expect(document.querySelector('#ai-profile-model')?.textContent).toContain(DEFAULT_SCREENING_SETTINGS.model)
  expect(document.querySelector('#ai-profile-follow-model')?.textContent).toContain(DEFAULT_SCREENING_SETTINGS.followModel)
  for (const [id, expected] of [
    ['state', DEFAULT_SCREENING_SETTINGS.state],
    ['instructions', DEFAULT_SCREENING_SETTINGS.instructions],
    ['non-english-text', DEFAULT_SCREENING_SETTINGS.nonEnglishText],
    ...Object.entries(DEFAULT_SCREENING_SETTINGS.criteria).map(([choice, prompt]) => [`criteria-${choice}`, prompt]),
  ])
    expect(document.querySelector<HTMLTextAreaElement>(`#ai-profile-${id}`)?.value).toBe(expected)
  await click('Save changes')
  expect(save).toHaveBeenCalledWith(expect.objectContaining({
    routine: expect.objectContaining({ ai: { interestMatch } }),
  }))
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
    modelIds: ['model'],
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
    modelIds: ['model'],
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
  expect(document.body.textContent).toContain('Daily outreach')
  expect(document.body.textContent).toContain('Initial follows per day')
  expect(document.body.textContent).toContain('Max follows per day')
  expect(document.body.textContent).not.toContain('Initial DMs per day')
})

test.each(['Follow new leads', 'Send DMs from notifications'])(
  'outreach saves %s independently and existing routines start with both on', async label => {
    const save = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useQuery).mockReturnValue([])
    vi.mocked(useMutation).mockReturnValue(Object.assign(save, { withOptimisticUpdate: () => { throw new Error('Unused') } }))
    const automation = { _id: 'automation', name: 'Routine', modelIds: ['model'],
      routine: { ...defaultRoutine, outreachEnabled: true, followingEnabled: undefined, notificationDmsEnabled: undefined,
        outreach: { leadListId: 'list', profileIds: [], allProfiles: true, message: 'Hello' } },
    } as unknown as Doc<'automations'>
    view = mount()
    await view.render(<RoutinePopup automation={automation} onClose={() => {}} />)
    await click('Outreach')
    const toggle = (text: string) => [...document.querySelectorAll('label')]
      .find(element => element.textContent === text)!.querySelector<HTMLButtonElement>('[role="switch"]')!
    expect(toggle('Follow new leads').getAttribute('aria-checked')).toBe('true')
    expect(toggle('Send DMs from notifications').getAttribute('aria-checked')).toBe('true')
    await act(async () => toggle(label).click())
    expect(document.querySelector<HTMLInputElement>('#initial-follows')?.closest('fieldset')?.disabled).toBe(label === 'Follow new leads')
    await click('Save changes')
    expect(save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ routine: expect.objectContaining({
      outreachEnabled: true, followingEnabled: label !== 'Follow new leads',
      notificationDmsEnabled: label !== 'Send DMs from notifications',
    }) }))
  },
)

test('interests add separate AI-rewritten tags, retain combinations, and save all descriptions', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  vi.mocked(useQuery).mockReturnValue([])
  vi.mocked(useMutation).mockReturnValue(Object.assign(save, { withOptimisticUpdate: () => { throw new Error('Unused') } }))
  vi.mocked(apiFetch).mockResolvedValueOnce({ description: 'Content featuring dancing or singing performances.' })
    .mockResolvedValueOnce({ description: 'Fishing techniques and angling trips.' })
  const automation = { _id: 'automation', name: 'Routine', modelIds: ['model'], routine: defaultRoutine } as unknown as Doc<'automations'>
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
  const automation = { _id: 'automation', name: 'Routine', modelIds: ['model'],
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
