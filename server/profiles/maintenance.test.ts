import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

for (const scenario of ['delete', 'partial cleanup', 'database unavailable', 'finalize unavailable', 'owners', 'locked', 'restart', 'rename', 'partial rename', 'delete during rename']) {
  test(`profile maintenance: ${scenario}`, () => {
    const output = execFileSync('bun', ['--eval', `
      import { mock } from 'bun:test'
      import assert from 'node:assert/strict'
      import fs from 'node:fs'
      import os from 'node:os'
      import path from 'node:path'
      const scenario = ${JSON.stringify(scenario)}
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-maintenance-'))
      const browserDir = path.join(root, 'data/profiles/Old')
      for (const dir of [browserDir]) {
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, 'keep'), 'identity')
      }
      let row = { id: 'profile-id', name: 'Old', status: scenario === 'restart' ? 'deleting' : 'idle', using: false }
      const events = []
      let failFinalize = scenario === 'finalize unavailable'
      mock.module('./server/shared/utils.ts', () => ({ resolveProjectRoot: () => root }))
      mock.module('./server/shared/convexClient.ts', () => ({
        profilesList: async () => row ? [row] : [],
        profilesGetByName: async () => row,
        profilesGetById: async () => row,
        profilesCreate: async () => undefined,
        profilesSyncStatus: async () => undefined,
        profilesBeginDelete: async () => {
          if (scenario === 'database unavailable') throw new Error('offline')
          if (row) row.status = 'deleting'
          return row
        },
        profilesFinishDelete: async id => {
          assert.equal(id, row.id)
          for (const name of ['Old', 'New']) {
            assert.equal(fs.existsSync(path.join(root, 'data/profiles', name)), false)
          }
          if (failFinalize) { failFinalize = false; throw new Error('offline') }
          row = null
        },
        profilesUpdateByName: async (old, update) => {
          row = { ...row, name: update.name, renameFrom: old }
          return row
        },
        profilesFinishRename: async () => { delete row.renameFrom },
      }))
      mock.module('./server/profiles/service.ts', () => ({ stopProfileBrowserLocked: async name => {
        assert.equal(row.status, 'deleting')
        events.push('manual')
        store.profileProcesses.delete(name)
      } }))
      mock.module('./server/automations/service.ts', () => ({ stopAutomations: async id => {
        events.push('automation')
        store.automationProfileSessions.delete(id)
      } }))
      const store = await import('./server/shared/store.ts')
      const { deleteProfile, retryProfileMaintenance, updateProfile } = await import('./server/profiles/maintenance.ts')
      const { lockProfile } = await import('./server/profiles/paths.ts')
      const originalRm = fs.promises.rm
      const originalRename = fs.promises.rename
      try {
        if (scenario === 'database unavailable') {
          await assert.rejects(deleteProfile('Old'), /offline/)
          assert.ok(fs.existsSync(browserDir))
        } else if (scenario === 'finalize unavailable') {
          await assert.rejects(deleteProfile('Old'), /pending/)
          assert.equal(row.status, 'deleting')
          assert.equal(fs.existsSync(browserDir), false)
          await retryProfileMaintenance()
          assert.equal(row, null)
        } else if (scenario === 'locked') {
          const unlock = lockProfile('Old')
          await assert.rejects(deleteProfile('Old'), /pending/)
          assert.ok(fs.existsSync(browserDir))
          unlock()
          await retryProfileMaintenance()
          assert.equal(row, null)
        } else if (scenario === 'partial cleanup') {
          fs.promises.rm = async (target, options) => {
            if (target === browserDir) throw Object.assign(new Error('locked file'), { code: 'EBUSY' })
            return originalRm(target, options)
          }
          await assert.rejects(deleteProfile('Old'), /pending/)
          assert.equal(row.status, 'deleting')
          assert.equal(fs.existsSync(browserDir), true)
          fs.promises.rm = originalRm
          await retryProfileMaintenance()
          assert.equal(row, null)
        } else if (['rename', 'partial rename', 'delete during rename'].includes(scenario)) {
          if (scenario !== 'rename') {
            fs.promises.rename = async (from, to) => {
              if (from === browserDir) throw new Error('locked browser directory')
              return originalRename(from, to)
            }
            await assert.rejects(updateProfile('Old', { name: 'New' }), /pending/)
            assert.equal(row.renameFrom, 'Old')
            fs.promises.rename = originalRename
            if (scenario === 'delete during rename') {
              await deleteProfile('New')
              assert.equal(row, null)
            } else await retryProfileMaintenance()
          } else await updateProfile('Old', { name: 'New' })
          if (row) {
            assert.equal(row.renameFrom, undefined)
            for (const folder of ['profiles']) {
              assert.equal(fs.readFileSync(path.join(root, 'data', folder, 'New/keep'), 'utf8'), 'identity')
              assert.equal(fs.existsSync(path.join(root, 'data', folder, 'Old')), false)
            }
          }
        } else {
          if (scenario === 'owners') {
            store.profileProcesses.set('Old', {})
            store.automationProfileSessions.set('automation', new Set(['Old']))
          }
          if (scenario === 'restart') await retryProfileMaintenance()
          else await deleteProfile('Old')
          assert.equal(row, null)
          if (scenario === 'owners') assert.deepEqual(events, ['manual', 'automation'])
          await deleteProfile('Old')
        }
        await assert.rejects(deleteProfile('../escape'), /Invalid profile/)
        console.log('maintenance verified')
      } finally {
        fs.promises.rm = originalRm
        fs.promises.rename = originalRename
        assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
        fs.rmSync(root, { recursive: true, force: true })
      }
    `], { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 15_000 })
    assert.match(output, /maintenance verified/)
  })
}
