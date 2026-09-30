import { createRef } from 'react'
import { afterEach, expect, test } from 'vite-plus/test'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Trigger as DialogTrigger } from '@radix-ui/react-dialog'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { mount } from './mount'

let view: ReturnType<typeof mount> | undefined

afterEach(async () => {
  await view?.unmount()
  view = undefined
})

test('ref props reach native controls and Radix Slot children', async () => {
  const button = createRef<HTMLButtonElement>()
  const input = createRef<HTMLInputElement>()
  const slotted = createRef<HTMLButtonElement>()
  view = mount()
  await view.render(
    <>
      <Button ref={button}>Save</Button>
      <Input ref={input} />
      <Button asChild ref={slotted}>
        <button>Child</button>
      </Button>
    </>,
  )
  expect(button.current?.textContent).toBe('Save')
  expect(slotted.current?.textContent).toBe('Child')
  input.current?.focus()
  expect(document.activeElement).toBe(input.current)
  await view.unmount()
  view = undefined
  expect(button.current).toBeNull()
  expect(input.current).toBeNull()
  expect(slotted.current).toBeNull()
})

test('Radix dialog refs, focus, and immediate close remain functional', async () => {
  const content = createRef<HTMLDivElement>()
  const trigger = createRef<HTMLButtonElement>()
  view = mount()
  const render = (open: boolean) =>
    view!.render(
      <Dialog open={open}>
        <DialogTrigger asChild>
          <Button ref={trigger}>Open</Button>
        </DialogTrigger>
        <DialogContent ref={content} aria-describedby={undefined}>
          <DialogTitle>Settings</DialogTitle>
          <Input aria-label="Name" />
        </DialogContent>
      </Dialog>,
    )
  await render(true)
  expect(content.current?.getAttribute('role')).toBe('dialog')
  expect(content.current?.contains(document.activeElement)).toBe(true)
  await render(false)
  expect(content.current).toBeNull()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(trigger.current)
})
