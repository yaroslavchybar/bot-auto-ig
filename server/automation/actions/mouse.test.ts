import { test } from 'node:test'
import { execFileSync } from 'node:child_process'

for (const nativeAvailable of [true, false]) test(`scroll cursor stays still between drifts and repositions after interactions (native=${nativeAvailable})`, () => {
  execFileSync('bun', ['--eval', `
    import assert from 'node:assert/strict'
    import { mock } from 'bun:test'
    let now = 0, cursor = { x: 400, y: 300 }, stopped = false
    let native = ${JSON.stringify(nativeAvailable)}
    Date.now = () => now
    Math.random = () => 0.25
    mock.module('./server/browser/desktopPointer.ts', () => ({ desktopCursorFor: () => native ? cursor : undefined }))
    const { positionScrollCursor } = await import('./server/automation/actions/mouse.ts')
    const { BrowseSession, SessionEnded } = await import('./server/automation/actions/session.ts')
    const moves = []
    const page = { mouse: { move: async (x, y) => { cursor = { x, y }; moves.push(cursor) } } }
    const bounds = { left: 100, right: 700, top: 100, bottom: 600 }
    const session = new BrowseSession(Infinity, () => stopped)
    const initial = await positionScrollCursor(page, bounds, session)
    const setupMoves = native ? 0 : 1
    assert.equal(moves.length, setupMoves, 'only an unknown initial cursor needs parking')
    for (now of [0, 500, 1200, 5000, 10_000, 20_000]) {
      assert.deepEqual(await positionScrollCursor(page, bounds, session), initial)
    }
    assert.equal(moves.length, setupMoves, 'scrolls do not force cursor movement')
    now = 30_000
    await positionScrollCursor(page, bounds, session)
    assert.equal(moves.length, setupMoves + 1)
    assert.ok(Math.abs(cursor.x - initial.x) <= 45 && Math.abs(cursor.y - initial.y) <= 45, 'drift stays small')
    assert.notDeepEqual(cursor, initial)
    now += 1000
    await positionScrollCursor(page, bounds, session)
    assert.equal(moves.length, setupMoves + 1, 'movement does not repeat on the next scroll')
    native = true
    cursor = { x: 900, y: 300 }
    await positionScrollCursor(page, bounds, session)
    assert.equal(moves.length, setupMoves + 2, 'native cursor takes precedence over any retained fallback')
    assert.ok(cursor.x > bounds.left && cursor.x < bounds.right && cursor.y > bounds.top && cursor.y < bounds.bottom)
    const parked = { ...cursor }
    native = false
    now += 1000
    assert.deepEqual(await positionScrollCursor(page, bounds, session), parked)
    assert.equal(moves.length, setupMoves + 2)
    stopped = true
    await assert.rejects(positionScrollCursor(page, bounds, session), SessionEnded)
    assert.equal(moves.length, setupMoves + 2, 'stopped sessions cannot move the cursor')
  `], { cwd: process.cwd(), encoding: 'utf8', timeout: 5000 })
})
