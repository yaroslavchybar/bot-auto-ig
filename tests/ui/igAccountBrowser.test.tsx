import { afterEach, expect, test, vi } from 'vite-plus/test'
import { mount } from './mount'
import { AccountsList } from '../../frontend/src/features/ig-accounts/components/AccountsList'
const layout = vi.hoisted(() => ({ mobile: false }))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => layout.mobile }))
let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
})
test.each([false, true])(
  'account list uses browser connection status on mobile=%s',
  async (mobile) => {
    layout.mobile = mobile
    view = mount()
    await view.render(
      <AccountsList
        accounts={[
          { id: 'account', username: 'example', status: 'connected', profileId: 'profile' },
        ]}
        loading={false}
      />,
    )
    expect(view.container.textContent).toContain('Connected')
    expect(view.container.textContent).not.toContain('Reconnect')
    expect(view.container.textContent).not.toContain('Logout')
  },
)
