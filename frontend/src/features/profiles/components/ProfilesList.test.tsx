import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import { ProfilesList } from './ProfilesList'

const noop = () => {}
const convex = new ConvexReactClient('https://example.convex.cloud')

function render(igLoggedIn: boolean, unreadDms: number) {
  return renderToStaticMarkup(
    <ConvexProvider client={convex}>
      <ProfilesList
        profiles={[{ id: 'p', name: 'Profile', igLoggedIn, unreadDms }]}
        loading={false}
        onDetails={noop}
        onEdit={noop}
        onDelete={noop}
        onLogs={noop}
        onToggleStatus={noop}
      />
    </ConvexProvider>
  )
}

test('unread DMs appear only for profiles marked logged in, including zero', () => {
  assert.match(render(true, 6), />6<\/td>/)
  assert.match(render(true, 0), />0<\/td>/)
  assert.doesNotMatch(render(false, 6), />6<\/td>/)
})
