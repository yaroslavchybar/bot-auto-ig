import { runtimeRequest } from '../shared/runtime.js'

export type ContentKind = 'posts' | 'avatars'
export async function allocateContent(
  modelId: string,
  kind: ContentKind,
  profileId: string,
  excludeIds: string[] = [],
): Promise<{ sourceId: string; path: string } | null> {
  return runtimeRequest('/content/allocate', {
    method: 'POST',
    body: JSON.stringify({ modelId, profileId, kind, excludeIds }),
  })
}
export async function availableSources(
  modelId: string,
  kind: ContentKind,
  profileId: string,
  excludeIds: string[] = [],
): Promise<number> {
  return runtimeRequest('/content/available', {
    method: 'POST',
    body: JSON.stringify({ modelId, profileId, kind, excludeIds }),
  })
}
