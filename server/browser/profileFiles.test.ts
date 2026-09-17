import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setupProfileFileAccess } from './profileFiles.js'

function sandbox(): { root: string; profileDir: string; uploadsDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-files-'))
  return {
    root,
    profileDir: path.join(root, 'profiles', 'some profile'),
    uploadsDir: path.join(root, 'uploads', 'profiles', 'some profile'),
  }
}

test('setup creates the uploads dir and points env at per-profile xdg', (t) => {
  const { root, profileDir, uploadsDir } = sandbox()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const access = setupProfileFileAccess({ profileDir, uploadsDir })
  assert.ok(fs.statSync(uploadsDir).isDirectory())
  assert.equal(access.env.XDG_CONFIG_HOME, path.join(profileDir, 'xdg'))
})

test('bookmarks expose only the profile folder and survive re-runs', (t) => {
  const { root, profileDir, uploadsDir } = sandbox()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const first = setupProfileFileAccess({ profileDir, uploadsDir })
  const bookmarks = path.join(first.xdgConfigDir, 'gtk-3.0', 'bookmarks')
  const lines = fs.readFileSync(bookmarks, 'utf8').trim().split('\n')
  assert.equal(lines.length, 1)
  assert.ok(lines[0]?.startsWith('file:///'))
  assert.ok(!lines[0]?.includes(' ' + 'general') && !lines[0]?.endsWith('/general'))

  // A user-added bookmark is preserved, ours is not duplicated.
  fs.appendFileSync(bookmarks, 'file:///tmp Stuff\n')
  setupProfileFileAccess({ profileDir, uploadsDir })
  const again = fs.readFileSync(bookmarks, 'utf8').trim().split('\n')
  assert.equal(again.length, 2)
  assert.ok(again[1] === 'file:///tmp Stuff')
})

test('dialog folder is preseeded for new profiles', (t) => {
  const { root, profileDir, uploadsDir } = sandbox()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  setupProfileFileAccess({ profileDir, uploadsDir })
  const prefs = JSON.parse(
    fs.readFileSync(path.join(profileDir, 'Default', 'Preferences'), 'utf8'),
  ) as { selectfile: { last_directory: string } }
  assert.equal(prefs.selectfile.last_directory, uploadsDir)
})

test('legacy dialog folder migrates, custom folders are kept', (t) => {
  const { root, profileDir, uploadsDir } = sandbox()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const prefsDir = path.join(profileDir, 'Default')
  fs.mkdirSync(prefsDir, { recursive: true })
  const legacy = path.join(root, 'old-shared-uploads')
  fs.mkdirSync(legacy, { recursive: true })

  fs.writeFileSync(
    path.join(prefsDir, 'Preferences'),
    JSON.stringify({ selectfile: { last_directory: legacy }, other: 1 }),
  )
  setupProfileFileAccess({ profileDir, uploadsDir, legacyDirs: [legacy] })
  const migrated = JSON.parse(fs.readFileSync(path.join(prefsDir, 'Preferences'), 'utf8')) as {
    selectfile: { last_directory: string }
    other: number
  }
  assert.equal(migrated.selectfile.last_directory, uploadsDir)
  assert.equal(migrated.other, 1)

  fs.writeFileSync(
    path.join(prefsDir, 'Preferences'),
    JSON.stringify({ selectfile: { last_directory: '/home/user/pics' } }),
  )
  setupProfileFileAccess({ profileDir, uploadsDir, legacyDirs: [legacy] })
  const kept = JSON.parse(fs.readFileSync(path.join(prefsDir, 'Preferences'), 'utf8')) as {
    selectfile: { last_directory: string }
  }
  assert.equal(kept.selectfile.last_directory, '/home/user/pics')
})
