import { act, useEffect, useState } from 'react'
import { afterEach, expect, test } from 'vite-plus/test'
import type { Id } from '../../convex/_generated/dataModel'
import type { OutreachRoute } from '../../convex/routinePolicy'
import { OutreachAssignments } from '@/features/automations/components/OutreachAssignments'
import { mount } from './mount'

const lists = [
  { _id: 'first' as Id<'leadLists'>, name: 'First purpose' },
  { _id: 'second' as Id<'leadLists'>, name: 'Second purpose' },
]
const profiles = [{ _id: 'profile' as Id<'profiles'>, name: 'Sender' }]
let saved: OutreachRoute[]
let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
})

function Editor({ disabled = false }: { disabled?: boolean }) {
  const [routes, setRoutes] = useState<OutreachRoute[]>([])
  useEffect(() => {
    saved = routes
  }, [routes])
  return (
    <OutreachAssignments
      routes={routes}
      lists={lists}
      profiles={profiles}
      loading={false}
      disabled={disabled}
      onChange={setRoutes}
    />
  )
}

async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === text,
  )!
  await act(async () => button.click())
}

test('assigns the same profile to multiple lists with separate messages and removes assignments', async () => {
  view = mount()
  await view.render(<Editor />)
  await click('Add list')
  await click('Add list')
  expect(saved.map((route) => route.leadListId)).toEqual(['first', 'second'])
  expect(document.querySelector<HTMLButtonElement>('button:disabled')?.textContent).toContain(
    'Add list',
  )
  for (const group of document.querySelectorAll('[role="group"]')) {
    await act(async () => group.querySelector<HTMLButtonElement>('button')!.click())
  }
  const inputs = document.querySelectorAll('textarea')
  for (const [index, input] of [...inputs].entries())
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        input,
        `Message ${index + 1}`,
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  expect(saved.map((route) => ({ profiles: route.profileIds, message: route.message }))).toEqual([
    { profiles: ['profile'], message: 'Message 1' },
    { profiles: ['profile'], message: 'Message 2' },
  ])
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Remove scraped list 1"]')!.click(),
  )
  expect(saved).toHaveLength(1)
  expect(saved[0].leadListId).toBe('second')
})

test('all-model assignment clears the explicit selection and disabled settings cannot change routes', async () => {
  view = mount()
  await view.render(<Editor />)
  await click('Add list')
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[role="group"] button')!.click(),
  )
  expect(saved[0].profileIds).toEqual(['profile'])
  await click('All profiles')
  expect(saved[0]).toMatchObject({ allProfiles: true, profileIds: [] })
  await view.render(<Editor disabled />)
  await click('Add list')
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Remove scraped list 1"]')!.click(),
  )
  expect(saved).toHaveLength(1)
})
