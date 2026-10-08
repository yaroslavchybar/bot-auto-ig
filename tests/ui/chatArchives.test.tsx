import { act, useState } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { ChatArchiveAction } from '@/features/chat/components/ChatArchiveAction'
import { ThreadList } from '@/features/chat/components/ThreadList'
import type { ChatFolder } from '@/features/chat/types'
import { mount } from './mount'

vi.mock('@/lib/auth', () => ({ useAppUser: () => null }))
vi.mock('@/lib/api', () => ({ apiFetchBlob: vi.fn() }))

let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
})

test('conversation control archives, restores, and disables changes while saving', async () => {
  const changes = vi.fn()
  function Probe({ disabled = false }: { disabled?: boolean }) {
    const [archived, setArchived] = useState(false)
    return (
      <ChatArchiveAction
        archived={archived}
        disabled={disabled}
        onChange={async (value) => {
          changes(value)
          setArchived(value)
        }}
      />
    )
  }
  view = mount()
  await view.render(<Probe />)
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Archive chat"]')!.click(),
  )
  expect(changes).toHaveBeenLastCalledWith(true)
  const restore = document.querySelector<HTMLButtonElement>('[aria-label="Move to inbox"]')!
  expect(restore).not.toBeNull()
  await view.render(<Probe disabled />)
  await act(async () => restore.click())
  expect(changes).toHaveBeenCalledTimes(1)
  await view.render(<Probe />)
  await act(async () => restore.click())
  expect(changes).toHaveBeenLastCalledWith(false)
})

test('folder control offers only Inbox and Archived with helpful empty states', async () => {
  const props = {
    threads: [],
    totalCount: 0,
    selectedThreadId: '',
    loading: false,
    disabled: false,
    searchQuery: '',
    onSearchChange: vi.fn(),
    onSelect: vi.fn(),
    now: Date.now(),
    onFolderChange: vi.fn(),
    archiveDisabled: false,
    onArchiveChange: vi.fn(async () => {}),
  }
  view = mount()
  for (const [folder, label, empty] of [
    ['inbox', 'Inbox', 'Inbox is empty'],
    ['archived', 'Archived', 'No archived chats'],
  ] as [ChatFolder, string, string][]) {
    await view.render(<ThreadList {...props} folder={folder} />)
    const group = document.querySelector('[aria-label="Conversation folder"]')!
    expect(group.querySelectorAll('button')).toHaveLength(2)
    expect(group.querySelector('[aria-pressed="true"]')?.textContent).toBe(label)
    await act(async () => group.querySelector<HTMLButtonElement>('[aria-pressed="true"]')!.click())
    expect(props.onFolderChange).toHaveBeenLastCalledWith(folder)
    expect(view.container.textContent).toContain(empty)
  }
  await view.render(<ThreadList {...props} totalCount={2} searchQuery="unknown" folder="inbox" />)
  expect(view.container.textContent).toContain('No matches')
})

test.each([false, true])(
  'right-click actions target the clicked chat without opening it (archived: %s)',
  async (archived) => {
    const onSelect = vi.fn()
    const onArchiveChange = vi.fn(async () => {})
    const props = {
      threads: [
        {
          id: '1',
          profileId: 'other',
          title: 'Client',
          users: [],
          messages: [],
          lastSeenAt: [],
          archived,
        },
      ],
      totalCount: 1,
      selectedThreadId: 'profile:1',
      loading: false,
      disabled: false,
      searchQuery: '',
      onSearchChange: vi.fn(),
      onSelect,
      now: Date.now(),
      folder: archived ? ('archived' as const) : ('inbox' as const),
      onFolderChange: vi.fn(),
      archiveDisabled: false,
      onArchiveChange,
    }
    view = mount()
    await view.render(<ThreadList {...props} />)
    const row = view.container.querySelector<HTMLButtonElement>('[role="option"]')!
    await act(async () =>
      row.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 30,
          clientY: 40,
        }),
      ),
    )
    const item = document.querySelector<HTMLElement>('[role="menuitem"]')!
    expect(item.textContent).toBe(archived ? 'Move to inbox' : 'Archive chat')
    expect(onSelect).not.toHaveBeenCalled()
    await act(async () => item.click())
    expect(onArchiveChange).toHaveBeenCalledExactlyOnceWith('other:1', !archived)
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()

    await view.render(<ThreadList {...props} archiveDisabled />)
    await act(async () =>
      row.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }),
      ),
    )
    const disabledItem = document.querySelector<HTMLElement>('[role="menuitem"]')!
    expect(disabledItem.getAttribute('aria-disabled')).toBe('true')
    await act(async () => disabledItem.click())
    expect(onArchiveChange).toHaveBeenCalledTimes(1)
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    )
    expect(document.querySelector('[role="menu"]')).toBeNull()
  },
)
