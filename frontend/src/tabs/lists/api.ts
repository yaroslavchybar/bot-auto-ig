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
  const [assigned, unassigned] = await Promise.allSettled([
    apiFetch<Array<{ profile_id: string; name: string }>>(`/api/profiles/assigned?list_id=${encodeURIComponent(listId)}`),
    apiFetch<Array<{ profile_id: string; name: string }>>('/api/profiles/unassigned'),
  ])

  const rows: ProfileRow[] = []
  
  if (assigned.status === 'fulfilled' && assigned.value) {
    for (const r of assigned.value) {
      rows.push({
        profile_id: String(r.profile_id),
        name: String(r.name || ''),
        selected: true,
        initialSelected: true,
      })
    }
  }

  if (unassigned.status === 'fulfilled' && unassigned.value) {
    for (const r of unassigned.value) {
      rows.push({
        profile_id: String(r.profile_id),
        name: String(r.name || ''),
        selected: false,
        initialSelected: false,
      })
    }
  }

  // Sort by name for better UX
  rows.sort((a, b) => a.name.localeCompare(b.name))
  
  return rows
}

export async function bulkSetListId(profileIds: string[], listId: string | null): Promise<void> {
  if (!profileIds.length) return
  await apiFetch('/api/profiles/bulk-set-list-id', {
    method: 'POST',
    body: { profileIds, listId },
  })
}
