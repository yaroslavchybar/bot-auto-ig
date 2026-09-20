import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProxiesList } from '../components/ProxiesList'
import { ProfilesList } from '../../profiles/components/ProfilesList'
import { ProfileDetails } from '../../profiles/components/ProfileDetails'

const noop = () => {}

test('list and detail markup, including tooltips, never contains proxy credentials', () => {
  for (const proxy of [
    'host:8080:privateuser:privatepassword',
    'socks5://privateuser:privatepassword@host:8080',
    'http://privateuser:private%70assword@host:8080',
    'http://privateuser:privatepassword@host:bad',
    'http://privateuser%3Aname:privatepassword@host:8080',
  ]) {
    const profile = { id: 'p', name: 'Profile', proxy, proxyType: 'socks5' }
    const views = [
      <ProxiesList proxies={[{ ...profile, maxProfiles: 3 }]} usage={{}} loading={false} onEdit={noop} onDelete={noop} />,
      <ProfilesList profiles={[profile]} loading={false} onDetails={noop} onEdit={noop} onDelete={noop} onLogs={noop} onToggleStatus={noop} />,
      <ProfileDetails profile={profile} />,
    ]
    for (const view of views) {
      const markup = renderToStaticMarkup(view)
      assert.doesNotMatch(markup, /privateuser|privatepassword|private%70assword/)
      assert.match(markup, /•••/)
    }
  }
})
