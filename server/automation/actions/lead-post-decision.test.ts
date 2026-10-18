import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideLeadPostGrid, leadGridTiles, matchLeadPostGrid } from './lead-post-decision.js'
import { TOPIC_MODEL } from './topic-intent.js'
import { BrowseSession, SessionEnded } from './session.js'
import { Window } from 'happy-dom'
import sharp from 'sharp'
import type { Page } from 'playwright-core'

test('lead grid decisions independently select only human thumbnails, ignoring avatars and comments', async () => {
  for (const score of [0, 0.69, 0.7, 1]) {
    const image = Buffer.from('lead-post-media')
    const fetcher = (async (_url: unknown, options: RequestInit) => {
      const body = JSON.parse(options.body as string)
      assert.equal(body.model, TOPIC_MODEL)
      assert.equal(
        body.state[1].image_url.url,
        `data:image/jpeg;base64,${image.toString('base64')}`,
      )
      assert.deepEqual(Object.keys(body.questions), ['post_1', 'post_2', 'post_3', 'post_4'])
      assert.match(body.state[0], /Evaluate each tile independently/)
      assert.match(
        body.state[0],
        /not adjacent tiles, author avatars, interface icons, captions or comments/,
      )
      for (const question of Object.values(body.questions) as { instructions: string }[])
        assert.match(question.instructions, /No interest, gender, age or identity classification/)
      assert.ok(options.signal instanceof AbortSignal)
      return Response.json({
        answers: Object.fromEntries(
          [0, score, 1, 0.69].map((noul, index) => [`post_${index + 1}`, { type: 'noul', noul }]),
        ),
      })
    }) as typeof fetch
    assert.deepEqual(
      await decideLeadPostGrid(image, 4, 3000, { key: 'test', fetcher }),
      score >= 0.7 ? [2, 3] : [3],
    )
  }
})

test('invalid or unavailable grid decisions never partially approve posts', async () => {
  for (const answer of [
    null,
    {},
    { type: 'choice', noul: 1 },
    ...['0.9', -1, 1.1, null].map((noul) => ({ type: 'noul', noul })),
  ]) {
    await assert.rejects(
      decideLeadPostGrid(Buffer.from('jpeg'), 2, 1000, {
        key: 'test',
        fetcher: (async () =>
          Response.json({
            answers: { post_1: { type: 'noul', noul: 1 }, post_2: answer },
          })) as typeof fetch,
      }),
    )
  }
  await assert.rejects(
    decideLeadPostGrid(Buffer.from('jpeg'), 2, 1000, {
      key: 'test',
      fetcher: (async () => new Response('', { status: 503 })) as typeof fetch,
    }),
    /HTTP 503/,
  )
})

test('invalid tile counts and empty grids never call the provider', async () => {
  for (const count of [0, 5, -1, 1.5]) {
    assert.deepEqual(
      await decideLeadPostGrid(Buffer.from('jpeg'), count, 1000, {
        key: 'test',
        fetcher: async () => {
          throw new Error('No grid to classify')
        },
      }),
      [],
    )
  }
})

async function gridFixture(count = 4, columns = 4) {
  const window = new Window({ width: 1000, height: 700 }),
    document = window.document
  document.body.innerHTML =
    '<main>' +
    Array.from({ length: count }, (_, i) => `<a href="/alice/p/post${i + 1}/"><img></a>`).join('') +
    '</main>'
  let scroll = 0
  for (const [index, node] of [...document.querySelectorAll('a')].entries()) {
    node.getBoundingClientRect = () =>
      ({
        x: 40 + (index % columns) * 201,
        y: 100 + Math.floor(index / columns) * 301 - scroll,
        width: 200,
        height: 300,
      }) as DOMRect
    Object.defineProperties(node.querySelector('img')!, {
      complete: { value: true, configurable: true },
      naturalWidth: { value: 1000, configurable: true },
    })
  }
  const image = await sharp({
    create: { width: 1000, height: 700, channels: 3, background: '#223344' },
  })
    .png()
    .toBuffer()
  let url = 'https://www.instagram.com/alice/',
    stopped = false,
    captures = 0,
    reveals = 0
  const page = {
    url: () => url,
    viewportSize: () => ({ width: 1000, height: 700 }),
    locator: (selector: string) => ({
      first() {
        return this
      },
      getAttribute: async (name: string) =>
        document.querySelector(selector)?.getAttribute(name) ?? null,
      evaluateAll: async (fn: (nodes: Element[], username: string) => unknown, username: string) =>
        fn([...document.querySelectorAll(selector)] as unknown as Element[], username),
    }),
    context: () => ({ newCDPSession: async () => ({
      send: async (command: string, options: Record<string, unknown>) => {
        captures++
        assert.equal(command, 'Page.captureScreenshot')
        assert.deepEqual(options, { format: 'png', fromSurface: false, captureBeyondViewport: false })
        return { data: image.toString('base64') }
      },
      detach: async () => {},
    }) }),
  } as unknown as Page
  const run = (request: NonNullable<Parameters<typeof matchLeadPostGrid>[4]>) =>
    matchLeadPostGrid(
      page,
      'alice',
      new BrowseSession(Date.now() + 30_000, () => stopped),
      () => {},
      request,
      async (_page, target, session) => {
        session.check()
        reveals++
        const href = await target.getAttribute('href')
        const index = [...document.querySelectorAll('a')].findIndex(
          (node) => node.getAttribute('href') === href,
        )
        assert.ok(index >= 0)
        scroll = Math.floor(index / columns) * 301
        for (const image of document.querySelectorAll('img'))
          Object.defineProperty(image, 'complete', { value: true, configurable: true })
        return true
      },
    )
  return {
    document,
    page,
    run,
    captures: () => captures,
    reveals: () => reveals,
    stop: () => {
      stopped = true
    },
    setUrl: (value: string) => {
      url = value
    },
    close: () => window.happyDOM.close(),
  }
}

test('numbered lead grid screenshots map matches to original post URLs before any post is opened', async () => {
  const s = await gridFixture(),
    before = s.document.body.innerHTML
  try {
    const selected = await s.run(async (image, count, timeout) => {
      assert.equal(count, 4)
      assert.ok(timeout > 0 && timeout <= 5000)
      const metadata = await sharp(image).metadata()
      assert.equal(metadata.format, 'jpeg')
      assert.equal(metadata.width, 803)
      assert.equal(metadata.height, 300)
      assert.ok(image.length <= 150_000)
      assert.equal(s.document.body.innerHTML, before, 'numeric labels stay in memory')
      return [2, 4]
    })
    assert.deepEqual(selected, ['/alice/p/post2/', '/alice/p/post4/'])
    assert.equal(s.captures(), 1)
  } finally {
    await s.close()
  }
})

test('lead grid matching returns no posts on provider failure or no-human answers', async () => {
  const s = await gridFixture()
  try {
    assert.deepEqual(
      await s.run(async () => {
        throw new Error('Provider unavailable')
      }),
      [],
    )
    assert.deepEqual(await s.run(async () => []), [])
  } finally {
    await s.close()
  }
})

test('an approved first row never scrolls or classifies a second row', async () => {
  const s = await gridFixture(6, 3)
  let requests = 0
  try {
    assert.deepEqual(
      await s.run(async () => {
        requests++
        return [2]
      }),
      ['/alice/p/post2/'],
    )
    assert.equal(requests, 1)
    assert.equal(s.captures(), 1)
    assert.equal(s.reveals(), 0)
  } finally {
    await s.close()
  }
})

for (const count of [4, 5, 6, 9])
  test(`no first-row match checks only the next available row (${count} posts)`, async () => {
    const s = await gridFixture(count, 3)
    let requests = 0
    // The fallback must reveal the next row even when its thumbnails have not loaded.
    for (const image of [...s.document.querySelectorAll('img')].slice(3))
      Object.defineProperty(image, 'complete', { value: false, configurable: true })
    try {
      const selected = await s.run(async (_image, tiles) => {
        requests++
        assert.equal(tiles, requests === 1 ? 3 : Math.min(3, count - 3))
        return requests === 1 ? [] : [tiles]
      })
      assert.deepEqual(selected, [`/alice/p/post${Math.min(6, count)}/`])
      assert.equal(requests, 2)
      assert.equal(s.captures(), 2)
      assert.equal(s.reveals(), 1)
    } finally {
      await s.close()
    }
  })

test('no approved posts in either row never checks a third row', async () => {
  const s = await gridFixture(9, 3)
  try {
    assert.deepEqual(await s.run(async () => []), [])
    assert.equal(s.captures(), 2)
    assert.equal(s.reveals(), 1)
  } finally {
    await s.close()
  }
})

test('a failed first-row request does not trigger a second request', async () => {
  const s = await gridFixture(6, 3)
  try {
    assert.deepEqual(
      await s.run(async () => {
        throw new Error('Provider unavailable')
      }),
      [],
    )
    assert.equal(s.captures(), 1)
    assert.equal(s.reveals(), 0)
  } finally {
    await s.close()
  }
})

test('cancellation during second-row classification cannot approve interaction', async () => {
  const s = await gridFixture(6, 3)
  let requests = 0
  try {
    await assert.rejects(
      s.run(async () => {
        if (++requests === 1) return []
        s.stop()
        return [1]
      }),
      SessionEnded,
    )
    assert.equal(requests, 2)
  } finally {
    await s.close()
  }
})

for (const change of ['recipient', 'grid', 'stop'] as const)
  test(`a changed ${change} during grid classification cannot approve interaction`, async () => {
    const s = await gridFixture()
    const request = async () => {
      if (change === 'recipient') s.setUrl('https://www.instagram.com/bob/')
      if (change === 'grid')
        s.document.querySelector('a')!.setAttribute('href', '/alice/p/replaced/')
      if (change === 'stop') s.stop()
      return [1]
    }
    try {
      if (change === 'stop') await assert.rejects(s.run(request), SessionEnded)
      else assert.deepEqual(await s.run(request), [])
    } finally {
      await s.close()
    }
  })

test('lead tiles exclude unloaded thumbnails, duplicate URLs and suggested posts', async () => {
  const s = await gridFixture()
  try {
    const original = s.document.querySelector('a')!
    s.document.querySelectorAll('a')[1]!.setAttribute('href', original.getAttribute('href')!)
    Object.defineProperty(s.document.querySelectorAll('img')[2]!, 'naturalWidth', { value: 0 })
    const aside = s.document.createElement('aside')
    s.document.querySelector('main')!.appendChild(aside)
    aside.appendChild(s.document.querySelectorAll('a')[3]!)
    assert.deepEqual(
      leadGridTiles([...s.document.querySelectorAll('a')] as unknown as Element[], 'alice').map(
        (tile) => tile.href,
      ),
      ['/alice/p/post1/'],
    )
  } finally {
    await s.close()
  }
})
