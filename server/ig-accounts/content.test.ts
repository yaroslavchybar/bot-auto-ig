import { afterEach, expect, test } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { addContent, allocateContent, availableSources, contentImage, copyImage, generateCopies, listCopies, removeContent } from './content.js'

let directory = ''
let spoofer: ReturnType<typeof createServer> | undefined
afterEach(async () => {
  delete process.env.MODEL_CONTENT_DIR
  delete process.env.SPOOFER_URL
  if (spoofer) {
    spoofer.closeAllConnections()
    await new Promise<void>(resolve => spoofer?.close(() => resolve()))
    spoofer = undefined
  }
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = ''
})

async function useDirectory() {
  directory = await mkdtemp(path.join(tmpdir(), 'model-content-test-'))
  process.env.MODEL_CONTENT_DIR = directory
}

/** Local spoofer stub that fails the request. */
async function useFailingSpoofer() {
  spoofer = createServer((_req, res) => {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'broken' }))
  })
  await new Promise<void>(resolve => spoofer?.listen(0, '127.0.0.1', resolve))
  const address = spoofer?.address()
  const port = typeof address === 'object' && address ? address.port : 0
  process.env.SPOOFER_URL = `http://127.0.0.1:${port}/variants`
}

/** Local spoofer stub that waits until released. */
async function useGatedSpoofer() {
  let release!: () => void
  const entered = new Promise<void>(resolve => { release = resolve as () => void })
  let releaseResponse!: () => void
  const responded = new Promise<void>(resolve => { releaseResponse = resolve })
  spoofer = createServer((_req, res) => {
    release()
    void responded.then(() => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ outputs: Array.from({ length: 50 }, (_, index) => ({ name: `copy_${index}.jpg` })) }))
    })
  })
  await new Promise<void>(resolve => spoofer?.listen(0, '127.0.0.1', resolve))
  const address = spoofer?.address()
  const port = typeof address === 'object' && address ? address.port : 0
  process.env.SPOOFER_URL = `http://127.0.0.1:${port}/variants`
  return { entered, respond: () => releaseResponse() }
}
async function useSpoofer(count: number, names?: string[]) {
  spoofer = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    const outputs = names ?? Array.from({ length: count }, (_, index) => `copy_${index}.jpg`)
    res.end(JSON.stringify({ outputs: outputs.map(name => ({ name })) }))
  })
  await new Promise<void>(resolve => spoofer?.listen(0, '127.0.0.1', resolve))
  const address = spoofer?.address()
  const port = typeof address === 'object' && address ? address.port : 0
  process.env.SPOOFER_URL = `http://127.0.0.1:${port}/variants`
}

test('upload stores the original with no copies until generation', async () => {
  await useDirectory()
  const added = await addContent('model-1', 'posts', 'photo.jpg', Buffer.from('original'))
  expect(added.variantCount).toBe(0)
  expect(await readFile(path.join(directory, 'model-1', 'posts', added.id, 'source.jpg'), 'utf8')).toBe('original')
  // The original is viewable but skipped by allocation until copies exist.
  expect((await contentImage('model-1', 'posts', added.id))?.bytes.toString()).toBe('original')
  expect(await allocateContent('model-1', 'posts', 'profile-0')).toBeNull()
  expect(await availableSources('model-1', 'posts', 'profile-0')).toBe(0)
  await expect(generateCopies('model-1', 'posts', 'missing')).rejects.toThrow('Image not found')
})

test('generation requires the kind to match and unique copy names', async () => {
  await useDirectory()
  const added = await addContent('model-1', 'posts', 'photo.jpg', Buffer.from('original'))
  await expect(generateCopies('model-1', 'avatars', added.id)).rejects.toThrow('Image not found')
  await useSpoofer(50, Array.from({ length: 50 }, () => 'same.jpg'))
  await expect(generateCopies('model-1', 'posts', added.id)).rejects.toThrow('1/50')
  expect(await allocateContent('model-1', 'posts', 'profile-0')).toBeNull()
})

test('a failed manifest write removes the uploaded directory', async () => {
  await useDirectory()
  await mkdir(path.join(directory, 'model-1', 'manifest.json'), { recursive: true })
  await expect(addContent('model-1', 'posts', 'photo.jpg', Buffer.from('original')))
    .rejects.toThrow()
  // The item directory is gone; only the empty kind parent remains.
  expect(await readdir(path.join(directory, 'model-1', 'posts'))).toEqual([])
})

test('generation fills 50 copies and refuses to run twice', async () => {
  await useDirectory()
  await useSpoofer(50)
  const added = await addContent('model-1', 'posts', 'photo.jpg', Buffer.from('original'))
  const generated = await generateCopies('model-1', 'posts', added.id)
  expect(generated.variantCount).toBe(50)
  const item = await allocateContent('model-1', 'posts', 'profile-0')
  expect(item?.sourceId).toBe(added.id)
  await expect(generateCopies('model-1', 'posts', added.id)).rejects.toThrow('Copies already exist')
})

test('generation fails loudly when the spoofer underproduces', async () => {
  await useDirectory()
  await useSpoofer(12)
  const added = await addContent('model-1', 'posts', 'photo.jpg', Buffer.from('original'))
  const variantsDir = path.join(directory, 'model-1', 'posts', added.id, 'variants')
  await mkdir(variantsDir, { recursive: true })
  await writeFile(path.join(variantsDir, 'stale.jpg'), 'stale')
  await expect(generateCopies('model-1', 'posts', added.id)).rejects.toThrow('12/50')
  expect(await allocateContent('model-1', 'posts', 'profile-0')).toBeNull()
  // Partial output is cleaned so the next attempt starts fresh.
  await expect(stat(variantsDir)).rejects.toThrow()
})

test('a spoofer request failure cleans up and surfaces the error', async () => {
  await useDirectory()
  await useFailingSpoofer()
  const added = await addContent('model-1', 'posts', 'photo.jpg', Buffer.from('original'))
  const variantsDir = path.join(directory, 'model-1', 'posts', added.id, 'variants')
  await mkdir(variantsDir, { recursive: true })
  await writeFile(path.join(variantsDir, 'stale.jpg'), 'stale')
  await expect(generateCopies('model-1', 'posts', added.id)).rejects.toThrow('broken')
  await expect(stat(variantsDir)).rejects.toThrow()
})

test('deleting the image mid-run fails generation without orphans', async () => {
  await useDirectory()
  const gate = await useGatedSpoofer()
  const added = await addContent('model-1', 'posts', 'photo.jpg', Buffer.from('original'))
  const first = generateCopies('model-1', 'posts', added.id)
  await gate.entered
  await removeContent('model-1', 'posts', added.id)
  gate.respond()
  await expect(first).rejects.toThrow('Image not found')
  await expect(stat(path.join(directory, 'model-1', 'posts', added.id))).rejects.toThrow()
})

test('a second generation run is rejected while one is in flight', async () => {
  await useDirectory()
  const gate = await useGatedSpoofer()
  const added = await addContent('model-1', 'posts', 'photo.jpg', Buffer.from('original'))
  const first = generateCopies('model-1', 'posts', added.id)
  await gate.entered
  await expect(generateCopies('model-1', 'posts', added.id)).rejects.toThrow('already running')
  gate.respond()
  expect((await first).variantCount).toBe(50)
})

test('removal deletes the row and its files', async () => {
  await useDirectory()
  const first = await addContent('model-1', 'avatars', 'one.jpg', Buffer.from('one'))
  const second = await addContent('model-1', 'avatars', 'two.jpg', Buffer.from('two'))
  // A mismatched kind must not delete the item.
  await expect(removeContent('model-1', 'posts', first.id)).rejects.toThrow('Image not found')
  expect(await contentImage('model-1', 'avatars', first.id)).not.toBeNull()
  expect(await removeContent('model-1', 'avatars', first.id)).toEqual({ removed: true })
  await expect(removeContent('model-1', 'avatars', first.id)).rejects.toThrow('Image not found')
  expect(await contentImage('model-1', 'avatars', first.id)).toBeNull()
  expect(await contentImage('model-1', 'avatars', second.id)).not.toBeNull()
})

test('copies are listed and served only from the manifest row', async () => {
  await useDirectory()
  const added = await addContent('model-1', 'posts', 'photo.jpg', Buffer.from('original'))
  await useSpoofer(50)
  await generateCopies('model-1', 'posts', added.id)
  const copies = await listCopies('model-1', 'posts', added.id)
  expect(copies).toHaveLength(50)
  await expect(listCopies('model-1', 'posts', 'missing')).rejects.toThrow('Image not found')
  expect(await copyImage('model-1', 'posts', added.id, '../manifest.json')).toBeNull()
  expect(await copyImage('model-1', 'avatars', added.id, copies[0])).toBeNull()
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
