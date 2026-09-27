import { afterEach, expect, test } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allocateContent, availableSources, contentImage } from './content.js'

let directory = ''
afterEach(async () => {
  delete process.env.MODEL_CONTENT_DIR
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = ''
})

test('original images are scoped to their model and content type', async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'model-content-test-'))
  process.env.MODEL_CONTENT_DIR = directory
  for (const modelId of ['model-1', 'model-2']) {
    const imageDir = path.join(directory, modelId, 'avatars', 'source-1')
    await mkdir(imageDir, { recursive: true })
    await writeFile(path.join(directory, modelId, 'manifest.json'), JSON.stringify([{
      id: 'source-1', kind: 'avatars', name: 'photo.png', variants: [], assigned: {}, createdAt: 1,
    }]))
    await writeFile(path.join(imageDir, 'source.png'), modelId)
  }

  expect((await contentImage('model-1', 'avatars', 'source-1'))?.bytes.toString()).toBe('model-1')
  expect((await contentImage('model-2', 'avatars', 'source-1'))?.bytes.toString()).toBe('model-2')
  expect(await contentImage('model-1', 'posts', 'source-1')).toBeNull()
  expect(await contentImage('model-1', 'avatars', 'missing')).toBeNull()
})

test('one source gives each account a distinct copy and stops at 50', async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'model-content-test-'))
  process.env.MODEL_CONTENT_DIR = directory
  await mkdir(path.join(directory, 'model-1'))
  await writeFile(path.join(directory, 'model-1', 'manifest.json'), JSON.stringify([{
    id: 'source-1', kind: 'posts', name: 'image.jpg',
    variants: Array.from({ length: 50 }, (_, index) => `image_${index}.jpg`),
    assigned: {}, createdAt: Date.now(),
  }]))
  const paths = []
  for (let index = 0; index < 50; index++) {
    const item = await allocateContent('model-1', 'posts', `profile-${index}`)
    paths.push(item?.path)
  }
  expect(new Set(paths).size).toBe(50)
  expect(await availableSources('model-1', 'posts', 'profile-50')).toBe(0)
  expect(await allocateContent('model-1', 'posts', 'profile-50')).toBeNull()
  expect((await allocateContent('model-1', 'posts', 'profile-0'))?.path).toBe(paths[0])
})
