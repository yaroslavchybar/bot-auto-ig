import { expect, test } from 'bun:test'
import { scanPage, SCAN_BATCH_LIMIT } from './pagination.js'

test('sparse searches stop at the batch budget and resume without losing matches', async () => {
  let calls = 0
  const fetch = async (cursor: string | null, count: number) => {
    calls++
    const start = Number(cursor ?? 0)
    const end = Math.min(start + count, 310)
    return {
      page: Array.from({ length: end - start }, (_, i) => start + i),
      continueCursor: String(end),
      isDone: end === 310,
    }
  }
  const first = await scanPage(fetch, (row) => row === 20 || row === 300, null)
  expect(calls).toBe(SCAN_BATCH_LIMIT)
  expect(first.page).toEqual([20])
  expect(first.isDone).toBe(false)
  const second = await scanPage(fetch, (row) => row === 20 || row === 300, first.continueCursor)
  expect(second.page).toEqual([300])
  expect(second.isDone).toBe(true)
})

test('empty partial pages carry a cursor and filled pages return immediately', async () => {
  let calls = 0
  const fetch = async (cursor: string | null, count: number) => {
    calls++
    const start = Number(cursor ?? 0)
    return {
      page: Array.from({ length: count }, (_, i) => start + i),
      continueCursor: String(start + count),
      isDone: false,
    }
  }
  const empty = await scanPage(fetch, () => false, null)
  expect(empty).toEqual({ page: [], continueCursor: '250', isDone: false })
  expect(calls).toBe(SCAN_BATCH_LIMIT)
  calls = 0
  expect((await scanPage(fetch, () => true, null)).page).toHaveLength(50)
  expect(calls).toBe(1)
})

test('a stalled cursor is rejected instead of repeating a batch', async () => {
  await expect(
    scanPage(
      async () => ({ page: [], continueCursor: 'stalled', isDone: false }),
      () => false,
      'stalled',
    ),
  ).rejects.toThrow('Pagination cursor did not advance')
})
