import { apiFetch } from '../../lib/api'
import type { List, ProfileRow } from './types'

export async function fetchLists(): Promise<List[]> {
  const data = await apiFetch<List[]>('/api/lists')
  return data || []
}

export async function createList(name: string): Promise<List | null> {
  const cleaned = name.trim()
  if (!cleaned) throw new Error('Name is required')
  return apiFetch<List | null>('/api/lists', {
    method: 'POST',
    body: { name: cleaned },
  })
}

export async function updateList(id: string, name: string): Promise<List | null> {
  const cleaned = name.trim()
  if (!id || !cleaned) throw new Error('ID and name are required')
  return apiFetch<List | null>('/api/lists/update', {
    method: 'POST',
    body: { id, name: cleaned },
  })
}

export async function deleteList(id: string): Promise<void> {
  if (!id) throw new Error('ID is required')
  await apiFetch('/api/lists/delete', {
    method: 'POST',
    body: { id },
  })
}

export async function fetchProfilesForEdit(listId: string): Promise<ProfileRow[]> {
  const allProfiles = await apiFetch<Array<{
    id?: string
    profile_id?: string
    name: string
    login?: boolean
    list_ids?: string[] | null
  }>>('/api/profiles')

  const rows: ProfileRow[] = (allProfiles || [])
    .filter((profile) => Boolean(profile?.login))
    .map((profile) => {
      const profileId = String(profile.id ?? profile.profile_id ?? '')
      const listIds = Array.isArray(profile.list_ids)
        ? profile.list_ids.map((id) => String(id || '')).filter(Boolean)
        : []
      const selected = listIds.includes(listId)
      return {
        profile_id: profileId,
        name: String(profile.name || ''),
        selected,
        initialSelected: selected,
      }
    })
    .filter((row) => Boolean(row.profile_id))

  // Sort by name for better UX
  rows.sort((a, b) => a.name.localeCompare(b.name))

  return rows
}

export async function bulkAddToList(profileIds: string[], listId: string): Promise<void> {
  if (!profileIds.length) return
  if (!listId) throw new Error('listId is required')
  await apiFetch('/api/profiles/bulk-add-to-list', {
    method: 'POST',
    body: { profileIds, listId },
  })
}

export async function bulkRemoveFromList(profileIds: string[], listId: string): Promise<void> {
  if (!profileIds.length) return
  if (!listId) throw new Error('listId is required')
  await apiFetch('/api/profiles/bulk-remove-from-list', {
    method: 'POST',
    body: { profileIds, listId },
  })
}
