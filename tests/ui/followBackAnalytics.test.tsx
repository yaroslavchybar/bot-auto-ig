import { afterEach, expect, test } from 'vite-plus/test'
import type { FunctionReturnType } from 'convex/server'
import type { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { FollowBackAnalytics } from '@/features/analytics/FollowBackAnalytics'
import { mount } from './mount'

type Outreach = FunctionReturnType<typeof api.analytics.overview>['outreach']
let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
})

test('follow-back analytics display account and weighted combined rates with a history boundary', async () => {
  const data: Outreach = {
    since: '2026-10-22',
    totals: { followed: 150, followedBack: 25, pending: 90, rate: (25 / 150) * 100 },
    accounts: [
      {
        profileId: 'one' as Id<'profiles'>,
        name: 'First',
        removed: false,
        followed: 100,
        followedBack: 15,
        pending: 50,
        rate: 15,
      },
      {
        profileId: 'two' as Id<'profiles'>,
        name: 'Second',
        removed: true,
        followed: 50,
        followedBack: 10,
        pending: 40,
        rate: 20,
      },
    ],
  }
  view = mount()
  await view.render(<FollowBackAnalytics data={data} />)
  const rows = view.container.querySelectorAll('tbody tr')
  expect(rows[0].textContent).toContain('First100155015%')
  expect(rows[1].textContent).toContain('SecondRemoved50104020%')
  expect(rows[2].textContent).toContain('Combined150259016.7%')
  expect(view.container.textContent).toContain('since 2026-10-22')
  expect(view.container.textContent).toContain('Earlier activity is not included')
})

test('empty conversion analytics show no percentage instead of zero or an invalid ratio', async () => {
  view = mount()
  await view.render(
    <FollowBackAnalytics
      data={{
        since: null,
        accounts: [],
        totals: { followed: 0, followedBack: 0, pending: 0, rate: null },
      }}
    />,
  )
  expect(view.container.textContent).toContain('No outreach accounts yet.')
  expect(view.container.textContent).toContain('—')
  expect(view.container.textContent).not.toContain('NaN')
})
