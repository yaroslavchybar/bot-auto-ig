/**
 * Message Templates Hook
 * 
 * Hook for fetching and saving message templates from Convex.
 * Used by MessageSettingsDialog and activities that need templates.
 */

import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../../../convex/_generated/api';
import { useState, useCallback } from 'react';

export type MessageTemplateKind = 'message' | 'message_2';

export function useMessageTemplates(kind: MessageTemplateKind) {
    const templates = useQuery(api.messageTemplates.get, { kind }) as string[] | undefined;
    const upsertMutation = useMutation(api.messageTemplates.upsert);

    const [error, setError] = useState<string | null>(null);

    const saveTemplates = useCallback(async (currentKind: MessageTemplateKind, newTemplates: string[]) => {
        setError(null);
        try {
            await upsertMutation({ kind: currentKind, texts: newTemplates });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save templates');
            throw err;
        }
    }, [upsertMutation]);

    return {
        templates: templates || [],
        loading: templates === undefined,
        error,
        saveTemplates
    };
}
