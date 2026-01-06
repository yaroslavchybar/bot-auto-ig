import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../../../convex/_generated/api';
import { useState, useCallback } from 'react';

export function useMessageTemplates(kind: 'message' | 'message_2') {
    const templates = useQuery(api.messageTemplates.get, { kind });
    const upsertMutation = useMutation(api.messageTemplates.upsert);

    const [error, setError] = useState<string | null>(null);

    const saveTemplates = useCallback(async (currentKind: 'message' | 'message_2', newTemplates: string[]) => {
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
