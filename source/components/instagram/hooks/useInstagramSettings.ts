import { useState, useCallback, useEffect, useRef } from 'react';
import { InstagramSettings, DEFAULT_SETTINGS, ACTIONS } from '../../../types/index.js';
import { instagramSettingsGet, instagramSettingsUpsert } from '../../../lib/supabase.js';
import { appendLog } from '../../../lib/logStore.js';
import { validateSettings } from '../../../lib/validation/settingsSchema.js';

export function useInstagramSettings() {
    const [settings, setSettings] = useState<InstagramSettings>(DEFAULT_SETTINGS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const saveInFlightRef = useRef<Promise<void> | null>(null);
    const pendingSaveRef = useRef<InstagramSettings | null>(null);

    const coerceBoolean = (val: any, fallback: boolean) => {
        if (typeof val === 'boolean') return val;
        if (typeof val === 'number') return val !== 0;
        if (typeof val === 'string') {
            const s = val.trim().toLowerCase();
            if (s === 'true' || s === '1' || s === 'yes' || s === 'y') return true;
            if (s === 'false' || s === '0' || s === 'no' || s === 'n' || s === '') return false;
        }
        return fallback;
    };

    const coerceNumber = (val: any, fallback: number) => {
        if (typeof val === 'number' && Number.isFinite(val)) return val;
        if (typeof val === 'string') {
            const parsed = Number.parseFloat(val.trim());
            if (Number.isFinite(parsed)) return parsed;
        }
        return fallback;
    };

    const normalizeStringArray = (val: any) => {
        if (!Array.isArray(val)) return [] as string[];
        const out: string[] = [];
        const seen = new Set<string>();
        for (const item of val) {
            const s = String(item ?? '').trim();
            if (!s) continue;
            if (seen.has(s)) continue;
            seen.add(s);
            out.push(s);
        }
        return out;
    };

    const normalizeActionOrder = (val: any) => {
        const list = Array.isArray(val) ? val : [];
        const out: any[] = [];
        const seen = new Set<any>();
        for (const item of list) {
            if (!ACTIONS.includes(item as any)) continue;
            if (seen.has(item)) continue;
            seen.add(item);
            out.push(item);
        }
        return out.length > 0 ? (out as any) : [...ACTIONS];
    };

    const clampNumber = (n: number, min: number, max: number) => {
        return Math.max(min, Math.min(max, n));
    };

    const normalizeLoadedSettings = (cloud: any): InstagramSettings => {
        const raw = typeof cloud === 'object' && cloud ? cloud : {};
        const merged: any = { ...DEFAULT_SETTINGS, ...raw };
        const next: any = { ...DEFAULT_SETTINGS };

        for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof InstagramSettings)[]) {
            if (key === 'action_order') {
                next.action_order = normalizeActionOrder(merged.action_order);
                continue;
            }
            if (key === 'source_list_ids') {
                next.source_list_ids = normalizeStringArray(merged.source_list_ids);
                continue;
            }

            const defVal: any = (DEFAULT_SETTINGS as any)[key];
            const val: any = merged[key as any];

            if (typeof defVal === 'boolean') next[key] = coerceBoolean(val, defVal);
            else if (typeof defVal === 'number') next[key] = coerceNumber(val, defVal);
            else next[key] = val ?? defVal;
        }

        next.max_sessions = clampNumber(next.max_sessions, 1, 100);
        next.parallel_profiles = clampNumber(next.parallel_profiles, 1, 10);
        next.like_chance = clampNumber(next.like_chance, 0, 100);
        next.follow_chance = clampNumber(next.follow_chance, 0, 100);
        next.reels_like_chance = clampNumber(next.reels_like_chance, 0, 100);
        next.reels_follow_chance = clampNumber(next.reels_follow_chance, 0, 100);
        next.reels_skip_chance = clampNumber(next.reels_skip_chance, 0, 100);

        return next as InstagramSettings;
    };

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const cloud = await instagramSettingsGet('global');
            const normalized = normalizeLoadedSettings(cloud);
            const validated = validateSettings(normalized);
            if (validated instanceof Error) throw validated;
            setSettings(validated);
            return validated;
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

    const persistLatest = useCallback((next: InstagramSettings) => {
        pendingSaveRef.current = next;

        if (saveInFlightRef.current) return;

        const run = async () => {
            while (pendingSaveRef.current) {
                const toSave = pendingSaveRef.current;
                pendingSaveRef.current = null;
                try {
                    await save(toSave);
                } catch {
                }
            }
        };

        const p = run().finally(() => {
            saveInFlightRef.current = null;
        });

        saveInFlightRef.current = p;
    }, [save]);

    const updateSettings = useCallback((next: InstagramSettings | ((prev: InstagramSettings) => InstagramSettings), persist = true) => {
        setSettings(prev => {
            const nextVal = typeof next === 'function' ? next(prev) : next;
            if (persist) {
                persistLatest(nextVal);
            }
            return nextVal;
        });
    }, [persistLatest]);

    useEffect(() => {
        load();
    }, [load]);

    return { settings, loading, saving, error, load, save, updateSettings, setSettings, setError };
}
