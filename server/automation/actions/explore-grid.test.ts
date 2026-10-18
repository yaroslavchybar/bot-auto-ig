import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import type { Page } from 'playwright-core'
import { decideExploreGrid, matchExploreGrid } from './explore-grid.js'
import { BrowseSession, SessionEnded } from './session.js'
import { gridCrop, gridRow, numberGridScreenshot, type GridTile } from './post-grid.js'

const tile = (number: number, x: number, y: number, width = 280, height = 374): GridTile => ({
  href: `/p/post_${number}/`,
  box: { x, y, width, height },
})
const row = [tile(1, 198, 88), tile(2, 479, 88), tile(3, 761, 88), tile(4, 1042, 88)]

test('Explore captures only one row of up to four tiles, ignoring the cut-off next row', () => {
  const all = [...row, tile(5, 198, 463), tile(6, 479, 463)]
  assert.deepEqual(gridRow(all, { width: 1440, height: 680 }), row)
  assert.deepEqual(gridCrop(row, { width: 1440, height: 680 }), {
    x: 198,
    y: 88,
    width: 1124,
    height: 374,
  })
  assert.deepEqual(
    gridRow(
      [
        tile(1, 10, 20, 120, 160),
        tile(2, 131, 20, 120, 160),
        tile(3, 252, 20, 120, 160),
        tile(4, 10, 181, 120, 160),
      ],
      { width: 390, height: 600 },
    ).map((item) => item.href),
    ['/p/post_1/', '/p/post_2/', '/p/post_3/'],
  )
  assert.equal(
    gridRow(
      Array.from({ length: 6 }, (_, i) => tile(i, i * 101, 10, 100, 150)),
      { width: 1000, height: 600 },
    ).length,
    4,
  )
})

test('numbered row screenshots are JPEGs under 150 KB and labels stay inside each tile', async () => {
  const crop = gridCrop(row, { width: 1440, height: 680 })
  const source = await sharp({
    create: { width: crop.width, height: crop.height, channels: 3, background: '#223344' },
  })
    .png()
    .toBuffer()
  const numbered = await numberGridScreenshot(source, row, crop)
  const metadata = await sharp(numbered).metadata()
  assert.equal(metadata.format, 'jpeg')
  assert.equal(metadata.width, crop.width)
  assert.equal(metadata.height, crop.height)
  assert.ok(numbered.length <= 150_000)
  const { data, info } = await sharp(numbered).raw().toBuffer({ resolveWithObject: true })
  for (const item of row) {
    const start = Math.round(item.box.x - crop.x + 10)
    let red = 0
    for (let y = 10; y < 44; y++)
      for (let x = start; x < start + 34; x++) {
        const offset = (y * info.width + x) * info.channels
        if (data[offset]! > data[offset + 1]! * 1.5) red++
      }
    assert.ok(red > 5, 'each tile contains its own red numeric label')
  }
})

test('grid matching asks independent questions and can select several posts, not just one winner', async () => {
  const fetcher: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    assert.deepEqual(Object.keys(body.questions), ['post_1', 'post_2', 'post_3', 'post_4'])
    for (const question of Object.values(body.questions) as {
      type: string
      instructions: string
    }[]) {
      assert.equal(question.type, 'noul')
      assert.match(question.instructions, /at least one independent/)
    }
    return Response.json({
      answers: {
        post_1: { type: 'noul', noul: 0.95 },
        post_2: { type: 'noul', noul: 0.2 },
        post_3: { type: 'noul', noul: 0.9 },
        post_4: { type: 'noul', noul: 0.1 },
      },
    })
  }
  assert.deepEqual(
    await decideExploreGrid(Buffer.from('jpeg'), 4, ['Fishing', 'Music performance'], 1000, {
      key: 'test',
      fetcher,
    }),
    [1, 3],
  )
  await assert.rejects(
    decideExploreGrid(Buffer.from('jpeg'), 2, ['Fishing'], 1000, {
      key: 'test',
      fetcher: async () => Response.json({ answers: { post_1: { type: 'noul', noul: 0.9 } } }),
    }),
    /invalid decision/,
  )
})

test('tile numbers resolve to original hrefs and a changing grid is skipped before sending an image', async () => {
  const crop = gridCrop(row, { width: 1440, height: 680 })
  const image = await sharp(Buffer.from(`<svg width="1440" height="680"><rect width="1440" height="680" fill="white"/><rect x="${crop.x}" y="${crop.y}" width="${crop.width}" height="${crop.height}" fill="#223344"/></svg>`)).png().toBuffer()
  let current = row,
    requests = 0
  const page = {
    viewportSize: () => ({ width: 1440, height: 680 }),
    locator: () => ({ evaluateAll: async () => current }),
    context: () => ({ newCDPSession: async () => ({
      send: async (command: string, options: Record<string, unknown>) => {
        assert.equal(command, 'Page.captureScreenshot')
        assert.deepEqual(options, { format: 'png', fromSurface: false, captureBeyondViewport: false })
        return { data: image.toString('base64') }
      },
      detach: async () => {},
    }) }),
  } as unknown as Page
  const request = async (image: Buffer, count: number) => {
    requests++
    assert.equal(count, 4)
    const metadata = await sharp(image).metadata()
    assert.equal(metadata.format, 'jpeg')
    assert.equal(metadata.width, crop.width)
    assert.equal(metadata.height, crop.height)
    const pixel = await sharp(image).extract({ left: 100, top: 100, width: 1, height: 1 }).raw().toBuffer()
    assert.ok(Math.abs(pixel[0] - 34) < 3 && Math.abs(pixel[1] - 51) < 3 && Math.abs(pixel[2] - 68) < 3,
      'the numbered image excludes the surrounding white viewport')
    return [2, 4]
  }
  assert.deepEqual(
    await matchExploreGrid(page, row, ['Fishing'], new BrowseSession(), () => {}, request),
    ['/p/post_2/', '/p/post_4/'],
  )
  current = row.map((item) => ({ ...item, box: { ...item.box, y: item.box.y + 40 } }))
  assert.deepEqual(
    await matchExploreGrid(page, row, ['Fishing'], new BrowseSession(), () => {}, request),
    [],
  )
  assert.equal(requests, 1)
  await assert.rejects(
    matchExploreGrid(page, row, ['Fishing'], new BrowseSession(0), () => {}, request),
    SessionEnded,
  )
})
