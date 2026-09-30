import { expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { IgApiClient } from 'instagram-private-api'
import { uploadChatAttachment, type AttachmentBody } from './attachments.js'

const ig = { state: { extractUserId: () => 'viewer', authorization: 'Bearer test', proxyUrl: '' },
  request: { getDefaultHeaders: () => ({ 'User-Agent': 'Instagram test' }) } } as unknown as IgApiClient

test('file uploads preserve Instagram headers, media IDs and resume offsets', async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'ig-attachment-test-'))
  try {
    for (const kind of ['photo', 'video', 'voice'] as const) {
      const bytes = kind === 'photo' ? Buffer.from([0xff, 0xd8, 0xff, 0xd9]) : Buffer.from('0000ftyp1234')
      const file: AttachmentBody = { id: 'test', path: path.join(directory, kind), size: bytes.length, voiceConverted: kind === 'voice' }
      await fs.writeFile(file.path, bytes)
      const calls: { method: string; headers: Record<string, string>; body?: AttachmentBody }[] = []
      const result = await uploadChatAttachment(ig, kind, file, kind === 'video' ? { width: 720, height: 1280, duration: 4 } : undefined,
        async (_ig, method, _endpoint, headers, body) => {
          calls.push({ method, headers, body })
          return method === 'GET' ? { offset: 2 } : { media_id: '12345' }
        })
      expect(result.mediaId).toBe('12345')
      const sent = calls.at(-1)!
      expect(sent.headers.authorization).toBe('Bearer test')
      expect(sent.headers['x-entity-length']).toBe(String(bytes.length))
      expect(sent.body?.path).toBe(file.path)
      expect(sent.body?.offset ?? 0).toBe(kind === 'photo' ? 0 : 2)
      expect(Buffer.isBuffer(sent.body)).toBe(false)
    }
    const file = { id: 'test', path: path.join(directory, 'video'), size: 12, voiceConverted: false }
    await expect(uploadChatAttachment(ig, 'voice', file)).rejects.toThrow('not converted')
    await expect(uploadChatAttachment(ig, 'video', file, { width: 1, height: 1, duration: 1 }, async () => ({ offset: 13 })))
      .rejects.toThrow('invalid offset')
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
