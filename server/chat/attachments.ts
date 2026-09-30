import type { StagedAttachment } from './uploads.js'
export type AttachmentKind = 'photo' | 'video' | 'voice'
export type VideoMetadata = { width: number; height: number; duration: number }
export type AttachmentBody = StagedAttachment
