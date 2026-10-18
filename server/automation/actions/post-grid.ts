import sharp from 'sharp'
import type { Page } from 'playwright-core'
import type { BrowseSession } from './session.js'
import { captureViewportScreenshot } from './screenshot.js'

type Box = { x: number; y: number; width: number; height: number }
export type GridTile = { href: string; box: Box }
const MAX_GRID_IMAGE_BYTES = 150_000

export function sameGridTiles(expected: readonly GridTile[], actual: readonly GridTile[]): boolean {
  return expected.every((tile) =>
    actual.some(
      (other) =>
        other.href === tile.href &&
        (['x', 'y', 'width', 'height'] as const).every(
          (key) => Math.abs(tile.box[key] - other.box[key]) <= 2,
        ),
    ),
  )
}

/** Use one visible row, left to right. Never merge partial tiles from the following row. */
export function gridRow(
  tiles: readonly GridTile[],
  viewport: { width: number; height: number },
): GridTile[] {
  const visible = tiles
    .filter(({ box }) => {
      const width = Math.min(viewport.width, box.x + box.width) - Math.max(0, box.x)
      const height = Math.min(viewport.height, box.y + box.height) - Math.max(0, box.y)
      return (
        box.width > 0 &&
        box.height > 0 &&
        width >= box.width * 0.9 &&
        height >= Math.min(box.height * 0.8, viewport.height * 0.8)
      )
    })
    .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)
  if (!visible.length) return []
  const top = visible[0]!.box.y
  return visible.filter((tile) => Math.abs(tile.box.y - top) < 4).slice(0, 4)
}

export function gridCrop(
  tiles: readonly GridTile[],
  viewport: { width: number; height: number },
): Box {
  const x = Math.max(0, Math.floor(Math.min(...tiles.map((tile) => tile.box.x))))
  const y = Math.max(0, Math.floor(Math.min(...tiles.map((tile) => tile.box.y))))
  const right = Math.min(
    viewport.width,
    Math.ceil(Math.max(...tiles.map((tile) => tile.box.x + tile.box.width))),
  )
  const bottom = Math.min(
    viewport.height,
    Math.ceil(Math.max(...tiles.map((tile) => tile.box.y + tile.box.height))),
  )
  return { x, y, width: right - x, height: bottom - y }
}

/** Number the image in memory, leaving the browser DOM untouched. */
export async function numberGridScreenshot(
  screenshot: Buffer,
  tiles: readonly GridTile[],
  crop: Box,
): Promise<Buffer> {
  const labels = tiles
    .map((tile, index) => {
      const x = Math.max(6, tile.box.x - crop.x + 10),
        y = Math.max(6, tile.box.y - crop.y + 10)
      return `<rect x="${x}" y="${y}" width="34" height="34" rx="6" fill="white"/><text x="${x + 17}" y="${y + 25}" text-anchor="middle" font-family="sans-serif" font-size="26" font-weight="bold" fill="#dc2626">${index + 1}</text>`
    })
    .join('')
  const overlay = Buffer.from(
    `<svg width="${crop.width}" height="${crop.height}" xmlns="http://www.w3.org/2000/svg">${labels}</svg>`,
  )
  const numbered = await sharp(screenshot)
    .composite([{ input: overlay }])
    .png()
    .toBuffer()
  for (const width of [1280, 960, 720]) {
    const result = await sharp(numbered)
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality: 65 })
      .toBuffer()
    if (result.length <= MAX_GRID_IMAGE_BYTES) return result
  }
  throw new Error('Post grid screenshot exceeds the image size budget')
}

/** Bind numbered pixels to exact post URLs without a browser-side crop or DOM labels. */
export async function captureGridScreenshot(
  page: Page,
  tiles: readonly GridTile[],
  session: BrowseSession,
  readTiles: () => Promise<GridTile[]>,
): Promise<Buffer> {
  session.check()
  if (!tiles.length || tiles.length > 4) throw new Error('Invalid post grid row')
  const viewport =
    page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
  if (!sameGridTiles(tiles, await readTiles())) throw new Error('Post grid moved before capture')
  const crop = gridCrop(tiles, viewport)
  const viewportImage = await captureViewportScreenshot(page, session)
  if (!sameGridTiles(tiles, await readTiles())) throw new Error('Post grid moved during capture')
  const raw = await sharp(viewportImage)
    .extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height })
    .png()
    .toBuffer()
  const screenshot = await numberGridScreenshot(raw, tiles, crop)
  session.check()
  return screenshot
}
