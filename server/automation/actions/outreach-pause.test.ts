import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Locator, Page } from 'playwright-core'
import { errors } from 'playwright-core'
import { Window } from 'happy-dom'
import { visitOutreachPausePage } from './outreach-pause.js'
import { BrowseSession, SessionEnded } from './session.js'

for (const destination of ['profile', 'dms'] as const)
  for (const mode of ['normal', 'missing', 'timeout', 'cancelled', 'disconnected'] as const)
    test(`pause visits click only the selected sidebar link: ${destination}, ${mode}`, async () => {
      const window = new Window(), originalNow = Date.now
      let now = originalNow(), stopped = false, clicks = 0, waits = 0
      let url = 'https://www.instagram.com/reels/current/'
      Date.now = () => now
      const parent = new BrowseSession(now + 60_000, () => stopped), until = now + 10_000
      const notes: Record<string, unknown>[] = []
      window.document.body.innerHTML = '<a href="/other/"><img alt="other profile picture"></a>' +
        '<a href="/self/"><div aria-selected="false"><img alt="self profile picture"></div></a>' +
        '<a href="/direct/inbox/"><svg aria-label="Messages"></svg></a>'
      if (mode === 'missing') window.document.querySelector(destination === 'profile' ? 'a[href="/self/"]' : 'a[href="/direct/inbox/"]')!.remove()
      const page = {
        url: () => url,
        locator: (selector: string) => {
          const node = window.document.querySelector(selector)
          return { filter() { return this }, first() { return this }, isVisible: async () => !!node,
            getAttribute: async (name: string) => node?.getAttribute(name),
          }
        },
        waitForURL: async (expected: string, options: { timeout: number }) => {
          waits++; assert.equal(url, expected); assert.ok(options.timeout <= until - now)
        },
      } as unknown as Page
      try {
        const run = visitOutreachPausePage(page, destination, until, parent, note => notes.push(note), {
          check: async () => {},
          click: async (_page: Page, link: Locator, session: BrowseSession) => {
            session.check(); clicks++
            assert.equal(session.end, until)
            assert.equal(await link.getAttribute('href'), destination === 'profile' ? '/self/' : '/direct/inbox/')
            if (mode === 'cancelled') { stopped = true; session.check() }
            if (mode === 'disconnected') throw new Error('Browser disconnected')
            if (mode === 'timeout') { now = until; throw new errors.TimeoutError('Navigation timed out') }
            url = new URL((await link.getAttribute('href'))!, url).href
          },
        })
        if (mode === 'cancelled') await assert.rejects(run, SessionEnded)
        else if (mode === 'disconnected') await assert.rejects(run, /Browser disconnected/)
        else await run
        assert.equal(clicks, mode === 'missing' ? 0 : 1)
        assert.equal(waits, mode === 'normal' ? 1 : 0)
        if (mode === 'normal' || mode === 'timeout') assert.equal(notes[0]?.outcome, mode === 'normal' ? 'opened' : 'skipped')
      } finally { Date.now = originalNow; await window.happyDOM.close() }
    })

test('an expired or nearly finished pause never starts sidebar navigation', async () => {
  const now = Date.now()
  for (const until of [now - 1, now + 1000])
    await visitOutreachPausePage({} as Page, 'profile', until, new BrowseSession(now + 60_000), () => {})
})
