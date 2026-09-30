import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react'
import { apiFetch } from '@/lib/api'
import type { ModelContentItem } from '../types'

type Snapshot = { items: ModelContentItem[]; loading: boolean; error: string }

function createEntry(modelId: string) {
  let snapshot: Snapshot = { items: [], loading: true, error: '' }
  let loaded = false
  let request: AbortController | undefined
  let pending: Promise<void> | undefined
  const listeners = new Set<() => void>()
  const publish = (next: Snapshot) => {
    snapshot = next
    listeners.forEach((listener) => listener())
  }
  const load = (force = false): Promise<void> => {
    if (!force && pending) return pending
    request?.abort()
    const controller = new AbortController()
    request = controller
    publish({ ...snapshot, loading: !loaded, error: '' })
    pending = apiFetch<ModelContentItem[]>(
      `/api/ig-accounts/models/${encodeURIComponent(modelId)}/content`,
      {
        signal: controller.signal,
      },
    )
      .then((items) => {
        if (controller.signal.aborted) return
        loaded = true
        publish({ items, loading: false, error: '' })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        loaded = true
        publish({
          ...snapshot,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        })
        if (force) throw error
      })
      .finally(() => {
        if (request === controller) {
          request = undefined
          pending = undefined
        }
      })
    return pending
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      if (!loaded) void load()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          request?.abort()
          request = undefined
          pending = undefined
        }
      }
    },
    reload: () => load(true),
  }
}

const ContentContext = createContext<Map<string, ReturnType<typeof createEntry>> | null>(null)

// Cache lives only while the models page is mounted; cards and dialogs share each entry.
export function ModelContentProvider({ children }: { children: ReactNode }) {
  const [entries] = useState(() => new Map<string, ReturnType<typeof createEntry>>())
  return <ContentContext.Provider value={entries}>{children}</ContentContext.Provider>
}

export function useModelContent(modelId: string) {
  const entries = useContext(ContentContext)
  if (!entries) throw new Error('ModelContentProvider is required')
  let entry = entries.get(modelId)
  if (!entry) {
    entry = createEntry(modelId)
    entries.set(modelId, entry)
  }
  const snapshot = useSyncExternalStore(entry.subscribe, entry.getSnapshot)
  return { ...snapshot, reload: entry.reload }
}
