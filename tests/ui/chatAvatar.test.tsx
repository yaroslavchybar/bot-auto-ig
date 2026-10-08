import { act } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { ChatAvatar } from '@/features/chat/components/ChatAvatar'
import { loadChatAvatar } from '@/features/chat/avatar'
import { mount } from './mount'

const state = vi.hoisted(() => ({ near: true, visible: true, userId: 'app-user' }))
vi.mock('@/lib/auth', () => ({ useAppUser: () => ({ id: state.userId }) }))
vi.mock('@/hooks/use-near-viewport', () => ({ useNearViewport: () => state.near }))
vi.mock('@/hooks/use-document-visibility', () => ({ useDocumentVisibility: () => state.visible }))
vi.mock('@/features/chat/avatar', () => ({ loadChatAvatar: vi.fn() }))

let view: ReturnType<typeof mount> | undefined
const createUrl = vi.fn(() => 'blob:local-avatar')
const revokeUrl = vi.fn()
const person = {
  id: '42',
  username: 'friend',
  profilePicUrl: 'https://scontent.cdninstagram.com/first.jpg',
}
const props = { profileId: 'profile', viewerId: 'viewer', users: [person], title: 'Friend' }

beforeEach(() => {
  state.near = true
  state.visible = true
  state.userId = 'app-user'
  vi.mocked(loadChatAvatar).mockResolvedValue(new Blob(['image'], { type: 'image/webp' }))
  vi.stubGlobal('URL', { createObjectURL: createUrl, revokeObjectURL: revokeUrl })
  vi.stubGlobal('Image', function () {
    const image = document.createElement('img')
    Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 128 } })
    return image
  })
})
afterEach(async () => {
  await view?.unmount()
  view = undefined
  vi.unstubAllGlobals()
})

test('contact pictures load on open, exclude the viewer, and do not refresh on metadata changes', async () => {
  view = mount()
  await view.render(
    <ChatAvatar
      {...props}
      users={[{ id: 'viewer', username: 'owner', profilePicUrl: 'owner-url' }, person]}
    />,
  )
  expect(loadChatAvatar).toHaveBeenLastCalledWith(
    'app-user',
    'profile',
    '42',
    expect.any(AbortSignal),
    expect.any(Function),
  )
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:local-avatar')
  await view.render(<ChatAvatar {...props} users={[{ ...person, profilePicUrl: 'new-url' }]} />)
  expect(revokeUrl).not.toHaveBeenCalled()
  expect(loadChatAvatar).toHaveBeenCalledTimes(1)
})

test('offscreen pictures wait to load and missing, failed, and group pictures show initials', async () => {
  state.near = false
  view = mount()
  await view.render(<ChatAvatar {...props} />)
  expect(loadChatAvatar).not.toHaveBeenCalled()
  expect(view.container.textContent).toBe('FR')
  state.near = true
  vi.mocked(loadChatAvatar).mockRejectedValueOnce(new Error('Unavailable'))
  await view.render(<ChatAvatar {...props} />)
  expect(view.container.querySelector('img')).toBeNull()
  expect(view.container.textContent).toBe('FR')
  vi.mocked(loadChatAvatar).mockClear()
  await view.render(<ChatAvatar {...props} users={[{ id: '42', username: 'friend' }]} />)
  await view.render(<ChatAvatar {...props} users={[person, { ...person, id: '43' }]} />)
  expect(loadChatAvatar).not.toHaveBeenCalled()
  expect(view.container.textContent).toBe('FR')
})

test('late results cannot show pictures after the user changes or the avatar unmounts', async () => {
  let resolve!: (blob: Blob) => void
  vi.mocked(loadChatAvatar).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  view = mount()
  await view.render(<ChatAvatar {...props} />)
  const signal = vi.mocked(loadChatAvatar).mock.calls[0][3]
  state.userId = ''
  await view.render(<ChatAvatar {...props} />)
  expect(signal.aborted).toBe(true)
  await act(async () => resolve(new Blob(['image'])))
  expect(createUrl).not.toHaveBeenCalled()
  expect(view.container.querySelector('img')).toBeNull()
})

test('pictures stay visible during refresh and do not refresh on a timer', async () => {
  let resolve!: (blob: Blob) => void
  const cached = new Blob(['cached'], { type: 'image/webp' })
  vi.mocked(loadChatAvatar).mockImplementationOnce((_user, _profile, _contact, _signal, show) => {
    show?.(cached)
    return new Promise((done) => {
      resolve = done
    })
  })
  createUrl.mockReturnValueOnce('blob:cached').mockReturnValueOnce('blob:fresh')
  view = mount()
  await view.render(<ChatAvatar {...props} />)
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:cached')
  await act(async () => resolve(new Blob(['fresh'], { type: 'image/webp' })))
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:fresh')
  expect(revokeUrl).toHaveBeenCalledWith('blob:cached')
  vi.useFakeTimers()
  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
    })
    expect(loadChatAvatar).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})
