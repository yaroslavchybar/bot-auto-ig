import { afterEach, expect, test, vi } from 'vite-plus/test'
import { AutomationsList } from '@/features/automations/components/AutomationsList'
import type { Automation } from '@/features/automations/types'
import type { Id } from '../../convex/_generated/dataModel'
import { defaultRoutine } from '../../convex/routinePolicy'
import { mount } from './mount'

const mocks = vi.hoisted(() => ({ mobile: false }))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mocks.mobile }))

let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
})

const automation: Automation = {
  _id: 'automation' as Id<'automations'>,
  _creationTime: 1,
  createdAt: 1,
  updatedAt: 1,
  name: 'Routine',
  nodes: [],
  edges: [],
  routine: defaultRoutine,
  status: 'cancelled',
  isActive: false,
}

async function render(overrides: Partial<Automation>, expected: string) {
  await view!.render(
    <AutomationsList
      automations={[{ ...automation, ...overrides }]}
      loading={false}
      onToggleActive={vi.fn()}
      onManage={vi.fn()}
      onDuplicate={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
  expect(view!.container.querySelector('[role="status"]')?.textContent).toBe(expected)
}

test.each([false, true])(
  'routine status follows enabling and worker activity (mobile: %s)',
  async (mobile) => {
    mocks.mobile = mobile
    view = mount()
    await render({}, 'Cancelled')
    await render({ isActive: true }, 'Waiting')
    await render({ isActive: true, status: 'running' }, 'Running')
    await render({ isActive: true, status: 'pending' }, 'Waiting')
    await render({ isActive: true, status: 'completed' }, 'Waiting')
    await render({ isActive: true, status: 'idle' }, 'Waiting')
    await render({ isActive: false }, 'Cancelled')
  },
)

test.each([false, true])(
  'failures, paused runs, and graph automations keep their status (mobile: %s)',
  async (mobile) => {
    mocks.mobile = mobile
    view = mount()
    await render({ isActive: true, status: 'failed', error: 'Browser failed' }, 'Failed')
    expect(view!.container.textContent).toContain('Browser failed')
    await render({ isActive: true, status: 'paused' }, 'Paused')
    await render({ routine: undefined, isActive: true }, 'Cancelled')
    await render({ routine: undefined, isActive: true, status: 'completed' }, 'Completed')
  },
)
