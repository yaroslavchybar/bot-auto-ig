import { act, useState } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { ChatTags } from '@/features/chat/components/ChatTags'
import { mount } from './mount'

let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
})

async function openEditor() {
  await act(async () => {
    document.querySelector<HTMLButtonElement>('button')!.click()
  })
}

async function enterTag(value: string) {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('[aria-label="New tag"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submitTag() {
  await act(async () => {
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

test('tags can be created, reused, and removed from a chat', async () => {
  const changes = vi.fn()
  function Probe() {
    const [tags, setTags] = useState(['customer'])
    return (
      <ChatTags
        tags={tags}
        availableTags={['customer', 'hot lead']}
        loading={false}
        onChange={async (tag, enabled) => {
          changes(tag, enabled)
          const cleaned = tag.trim().toLowerCase()
          setTags((previous) =>
            enabled
              ? [...new Set([...previous, cleaned])]
              : previous.filter((item) => item !== cleaned),
          )
        }}
      />
    )
  }
  view = mount()
  await view.render(<Probe />)
  await openEditor()
  await enterTag('VIP')
  await submitTag()
  expect(changes).toHaveBeenLastCalledWith('VIP', true)
  expect(document.querySelector('[aria-label="Remove tag vip"]')).not.toBeNull()
  expect(document.querySelector<HTMLInputElement>('[aria-label="New tag"]')!.value).toBe('')
  await act(async () => {
    const label = [...document.querySelectorAll('label')].find(
      (item) => item.textContent === 'hot lead',
    )!
    label.querySelector<HTMLInputElement>('input')!.click()
  })
  expect(changes).toHaveBeenLastCalledWith('hot lead', true)
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[aria-label="Remove tag customer"]')!.click()
  })
  expect(changes).toHaveBeenLastCalledWith('customer', false)
  expect(document.querySelector('[aria-label="Remove tag customer"]')).toBeNull()
})

test('a failed save keeps the tag input and reports the error', async () => {
  const changes = vi.fn().mockRejectedValue(new Error('Could not save tag'))
  view = mount()
  await view.render(<ChatTags tags={[]} availableTags={[]} loading={false} onChange={changes} />)
  await openEditor()
  await enterTag('customer')
  await submitTag()
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('Could not save tag')
  expect(document.querySelector<HTMLInputElement>('[aria-label="New tag"]')!.value).toBe('customer')
})
