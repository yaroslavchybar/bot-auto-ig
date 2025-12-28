import { useState, useCallback, useEffect } from 'react';
import { InstagramSettings, DEFAULT_SETTINGS, ACTIONS } from '../../../types/index.js';
import { instagramSettingsGet, instagramSettingsUpsert } from '../../../lib/supabase.js';
import { appendLog } from '../../../lib/logStore.js';
import { validateSettings } from '../../../lib/validation/settingsSchema.js';

export function useInstagramSettings() {
    const [settings, setSettings] = useState<InstagramSettings>(DEFAULT_SETTINGS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const cloud = await instagramSettingsGet('global');
            const merged: InstagramSettings = {
                ...DEFAULT_SETTINGS,
                ...(typeof cloud === 'object' && cloud ? cloud : {}),
            };
            merged.action_order = Array.isArray(merged.action_order) && merged.action_order.length > 0 ? merged.action_order : [...ACTIONS];
            merged.source_list_ids = Array.isArray(merged.source_list_ids) ? merged.source_list_ids : [];
            setSettings(merged);
            return merged;
        } catch (e: any) {
            setSettings(DEFAULT_SETTINGS);
            setError(e?.message || String(e));
            return DEFAULT_SETTINGS;
        } finally {
            setLoading(false);
        }
    }, []);

    const save = useCallback(async (next: InstagramSettings) => {
        const validated = validateSettings(next);
        if (validated instanceof Error) {
            setError(validated.message);
            appendLog(`Settings validation failed: ${validated.message}`, 'instagram');
            throw validated;
        }

        setSaving(true);
        setError(null);
        try {
            await instagramSettingsUpsert('global', next as any);
        } catch (e: any) {
            setError(e?.message || String(e));
            throw e;
        } finally {
            setSaving(false);
        }
    }, []);

    const updateSettings = useCallback((next: InstagramSettings | ((prev: InstagramSettings) => InstagramSettings), persist = true) => {
        setSettings(prev => {
            const nextVal = typeof next === 'function' ? next(prev) : next;
            if (persist) {
                save(nextVal).catch(() => { });
            }
            return nextVal;
        });
    }, [save]);

    useEffect(() => {
        load();
    }, [load]);

    return { settings, loading, saving, error, load, save, updateSettings, setSettings, setError };
}
