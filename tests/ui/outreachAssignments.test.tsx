import { act, useEffect, useState } from 'react'
import { afterEach, expect, test } from 'vite-plus/test'
import type { Id } from '../../convex/_generated/dataModel'
import type { OutreachAssignment } from '../../convex/routinePolicy'
import { OutreachAssignments } from '@/features/automations/components/OutreachAssignments'
import { mount } from './mount'

const lists = [
  { _id: 'first' as Id<'leadLists'>, name: 'First purpose' },
  { _id: 'second' as Id<'leadLists'>, name: 'Second purpose' },
]
const profiles = [{ _id: 'profile' as Id<'profiles'>, name: 'Sender' }]
let saved: OutreachAssignment | undefined
let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
})

function Editor({ disabled = false }: { disabled?: boolean }) {
  const [routes, setRoutes] = useState<OutreachAssignment>()
  useEffect(() => {
    saved = routes
  }, [routes])
  return (
    <OutreachAssignments
      assignment={routes}
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

test('assigns one scraped list, edits its profiles and message, and removes it', async () => {
  view = mount()
  await view.render(<Editor />)
  await click('Add list')
  expect(saved?.leadListId).toEqual('first')
  expect(
    [...document.querySelectorAll('button')].some((button) =>
      button.textContent?.includes('Add list'),
    ),
  ).toBe(false)
  expect(document.querySelector('[aria-label="Scraped list"]')).not.toBeNull()
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
  expect({ profiles: saved?.profileIds, message: saved?.message }).toEqual({ profiles: ['profile'], message: 'Message 1' })
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Remove scraped list"]')!.click(),
  )
  expect(saved).toBeUndefined()
  await click('Add list')
  expect(saved?.leadListId).toEqual('first')
})

test('all-model assignment clears the explicit selection and disabled settings cannot change routes', async () => {
  view = mount()
  await view.render(<Editor />)
  await click('Add list')
  await act(async () => document.querySelector<HTMLButtonElement>('[role="group"] button')!.click())
  expect(saved!.profileIds).toEqual(['profile'])
  await click('All profiles')
  expect(saved!).toMatchObject({ allProfiles: true, profileIds: [] })
  await view.render(<Editor disabled />)
  await click('Choose profiles')
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Remove scraped list"]')!.click(),
  )
  expect(saved).toBeDefined()
  expect(saved!).toMatchObject({ allProfiles: true, profileIds: [] })
})
