/**
 * Message Templates Hook
 *
 * Hook for fetching and saving message templates from Convex.
 * Used by MessageSettingsDialog and activities that need templates.
 */

import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../../../../convex/_generated/api'
import { useCallback } from 'react'
import { useErrorHandler } from '@/hooks/useErrorHandler'

export type MessageTemplateKind = 'message' | 'message_2'

export function useMessageTemplates(kind: MessageTemplateKind) {
  const templates = useQuery(api.messageTemplates.get, { kind }) as
    | string[]
    | undefined
  const upsertMutation = useMutation(api.messageTemplates.upsert)
  const { handleError } = useErrorHandler()

  const saveTemplates = useCallback(
    async (currentKind: MessageTemplateKind, newTemplates: string[]) => {
      try {
        await upsertMutation({ kind: currentKind, texts: newTemplates })
      } catch (err) {
        handleError(err, 'Save templates')
        throw err
      }
    },
    [handleError, upsertMutation],
  )

  return {
    templates: templates || [],
    loading: templates === undefined,
    saveTemplates,
  }
}


