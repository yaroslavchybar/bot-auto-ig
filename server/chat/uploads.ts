import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import { runtimeUrl, runtimeRequest } from '../shared/runtime.js'
import { currentRequestId } from '../shared/logger.js'
import { AppError, ValidationError } from '../shared/errors.js'
import type { AttachmentKind } from './attachments.js'

export type StagedAttachment = { id: string; path: string; size: number; voiceConverted: boolean; offset?: number }

/** The Rust helper owns temporary files. Only the small descriptor returns to the API. */
export async function stageAttachment(request: IncomingMessage, kind: AttachmentKind, signal: AbortSignal): Promise<StagedAttachment> {
  const response = await fetch(`${runtimeUrl()}/uploads?kind=${kind}`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Request-Id': currentRequestId() || crypto.randomUUID() },
    body: Readable.toWeb(request) as unknown as ReadableStream<Uint8Array>,
    signal: AbortSignal.any([signal, AbortSignal.timeout(185_000)]), duplex: 'half',
  } as RequestInit & { duplex: 'half' })
  const result = await response.json() as StagedAttachment & { error?: string }
  if (!response.ok) {
    if (response.status === 429) throw new AppError('Too many simultaneous uploads', 429, 'UPLOAD_BUSY')
    throw new ValidationError(result.error || 'Attachment upload failed')
  }
  return result
}

export async function removeAttachment(file: StagedAttachment): Promise<void> {
  await runtimeRequest(`/uploads/${encodeURIComponent(file.id)}`, { method: 'DELETE', signal: AbortSignal.timeout(5000) })
}
