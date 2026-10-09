import { useMemo } from 'react'
import { useQueries, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { api } from '../../../../../convex/_generated/api'
import type { ChatThread } from '../types'

export function useChatLists(threads: ChatThread[], profileId: string, viewerId: string) {
  const lists = useQuery(api.leads.lists, {})
  const contacts = useMemo(() => {
    const seen = new Map<string, { profileId: string; igId: string; username: string }>()
    for (const thread of threads)
      for (const user of thread.users) {
        if (!user.id || user.id === (thread.viewerId ?? viewerId)) continue
        const sender = thread.profileId ?? profileId
        seen.set(`${sender}:${user.id}`, {
          profileId: sender,
          igId: user.id,
          username: user.username,
        })
      }
    return [...seen.values()].sort((a, b) =>
      `${a.profileId}:${a.igId}`.localeCompare(`${b.profileId}:${b.igId}`),
    )
  }, [threads, profileId, viewerId])
  // Bound each subscription even when All profiles contains thousands of contacts.
  const queries = useMemo(
    () =>
      Object.fromEntries(
        Array.from({ length: Math.ceil(contacts.length / 200) }, (_, index) => [
          String(index),
          {
            query: api.chatFilters.contacts,
            args: { contacts: contacts.slice(index * 200, (index + 1) * 200) },
          },
        ]),
      ),
    [contacts],
  )
  const results = useQueries(queries)
  const batches = Object.values(results) as (
    | FunctionReturnType<typeof api.chatFilters.contacts>
    | Error
    | undefined
  )[]
  const failure = batches.find((batch) => batch instanceof Error)
  if (failure instanceof Error) throw failure
  const rows = batches.flatMap((batch) => (Array.isArray(batch) ? batch : []))
  const membership = useMemo(
    () => new Map((rows ?? []).map((row) => [`${row.profileId}:${row.igId}`, row.listIds])),
    [rows],
  )
  const threadLists = useMemo(
    () =>
      new Map(
        threads.map((thread) => {
          const sender = thread.profileId ?? profileId
          const ids = new Set<string>()
          for (const user of thread.users)
            for (const id of membership.get(`${sender}:${user.id}`) ?? []) ids.add(id)
          return [`${sender}:${thread.id}`, ids] as const
        }),
      ),
    [threads, profileId, membership],
  )
  return {
    lists: lists ?? [],
    threadLists,
    listsLoading: lists === undefined,
    loading: lists === undefined || batches.some((batch) => batch === undefined),
  }
}
