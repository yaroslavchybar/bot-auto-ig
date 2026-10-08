import { apiFetchBlob } from '@/lib/api'
import { AVATAR_REFRESH_MS, readChatAvatar, saveChatAvatar } from './cache'

const downloads = new Map<string, Promise<Blob>>()

// List and conversation header share a download; each device stores the resulting image locally.
export async function loadChatAvatar(
  userId: string,
  profileId: string,
  instagramId: string,
  signal: AbortSignal,
  onCached?: (blob: Blob) => void,
): Promise<Blob> {
  signal.throwIfAborted()
  const fresh = await readChatAvatar(userId, profileId, instagramId, AVATAR_REFRESH_MS)
  signal.throwIfAborted()
  if (fresh) return fresh
  const cached = await readChatAvatar(userId, profileId, instagramId)
  signal.throwIfAborted()
  if (cached) onCached?.(cached)
  const key = JSON.stringify([userId, profileId, instagramId])
  let download = downloads.get(key)
  if (!download) {
    download = apiFetchBlob(
      `/api/chat/${encodeURIComponent(profileId)}/avatars/${encodeURIComponent(instagramId)}/image`,
      { maxRetries: 0, timeout: 15_000 },
    ).finally(() => downloads.delete(key))
    downloads.set(key, download)
  }
  let blob: Blob
  try {
    blob = await download
  } catch (error) {
    signal.throwIfAborted()
    if (cached) return cached
    throw error
  }
  signal.throwIfAborted()
  await saveChatAvatar(userId, profileId, instagramId, blob)
  signal.throwIfAborted()
  return blob
}
