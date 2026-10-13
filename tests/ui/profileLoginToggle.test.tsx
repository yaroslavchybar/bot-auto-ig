import { act } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { IgStateToggles } from '@/features/profiles/components/IgStateToggles'
import { mount } from './mount'

const update = vi.hoisted(() => vi.fn())
vi.mock('convex/react', () => ({ useMutation: () => update }))
let view: ReturnType<typeof mount> | undefined
afterEach(async () => { await view?.unmount(); view = undefined; update.mockReset() })

test('profiles expose only the login switch and send no outreach override', async () => {
  update.mockResolvedValue(undefined)
  view = mount()
  await view.render(<IgStateToggles profile={{ id: 'profile', name: 'Model', igLoggedIn: false, outreachReady: true }} />)
  const switches = view.container.querySelectorAll<HTMLButtonElement>('[role="switch"]')
  expect(switches).toHaveLength(1)
  expect(switches[0].getAttribute('aria-label')).toBe('Logged in: Model')
  expect(view.container.querySelector('[aria-label^="Ready for outreach"]')).toBeNull()
  await act(async () => switches[0].click())
  expect(update).toHaveBeenCalledWith({ profileId: 'profile', igLoggedIn: true })
})
