import { useState, useCallback, useEffect, useRef } from 'react';
import type { InstagramSettings, ActionName } from '../types';
import { DEFAULT_SETTINGS, ACTIONS } from '../types';

const API_BASE = 'http://localhost:3001';
const STORAGE_KEY = 'cached_instagram_settings';

export function useInstagramSettings() {
    const [settings, setSettings] = useState<InstagramSettings>(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
        } catch {
            return DEFAULT_SETTINGS;
        }
    });
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const saveInFlightRef = useRef<Promise<void> | null>(null);
    const pendingSaveRef = useRef<InstagramSettings | null>(null);

    const coerceBoolean = (val: unknown, fallback: boolean): boolean => {
        if (typeof val === 'boolean') return val;
        if (typeof val === 'number') return val !== 0;
        if (typeof val === 'string') {
            const s = val.trim().toLowerCase();
            if (s === 'true' || s === '1' || s === 'yes' || s === 'y') return true;
            if (s === 'false' || s === '0' || s === 'no' || s === 'n' || s === '') return false;
        }
        return fallback;
    };

    const coerceNumber = (val: unknown, fallback: number): number => {
        if (typeof val === 'number' && Number.isFinite(val)) return val;
        if (typeof val === 'string') {
            const parsed = Number.parseFloat(val.trim());
            if (Number.isFinite(parsed)) return parsed;
        }
        return fallback;
    };

    const normalizeStringArray = (val: unknown): string[] => {
        if (!Array.isArray(val)) return [];
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

    const normalizeActionOrder = (val: unknown): ActionName[] => {
        const list = Array.isArray(val) ? val : [];
        const out: ActionName[] = [];
        const seen = new Set<ActionName>();
        for (const item of list) {
            if (!ACTIONS.includes(item as ActionName)) continue;
            if (seen.has(item as ActionName)) continue;
            seen.add(item as ActionName);
            out.push(item as ActionName);
        }
        return out.length > 0 ? out : [...ACTIONS];
    };

    const clampNumber = (n: number, min: number, max: number): number => {
        return Math.max(min, Math.min(max, n));
    };

    const normalizeLoadedSettings = (cloud: unknown): InstagramSettings => {
        const raw = typeof cloud === 'object' && cloud ? cloud : {};
        const merged = { ...DEFAULT_SETTINGS, ...raw } as Record<string, unknown>;
        const next = { ...DEFAULT_SETTINGS } as Record<string, unknown>;

        for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof InstagramSettings)[]) {
            if (key === 'action_order') {
                next.action_order = normalizeActionOrder(merged.action_order);
                continue;
            }
            if (key === 'source_list_ids') {
                next.source_list_ids = normalizeStringArray(merged.source_list_ids);
                continue;
            }

            const defVal = DEFAULT_SETTINGS[key];
            const val = merged[key];

            if (typeof defVal === 'boolean') next[key] = coerceBoolean(val, defVal);
            else if (typeof defVal === 'number') next[key] = coerceNumber(val, defVal);
            else next[key] = val ?? defVal;
        }

        next.max_sessions = clampNumber(next.max_sessions as number, 1, 100);
        next.parallel_profiles = clampNumber(next.parallel_profiles as number, 1, 10);
        next.like_chance = clampNumber(next.like_chance as number, 0, 100);
        next.follow_chance = clampNumber(next.follow_chance as number, 0, 100);
        next.reels_like_chance = clampNumber(next.reels_like_chance as number, 0, 100);
        next.reels_follow_chance = clampNumber(next.reels_follow_chance as number, 0, 100);
        next.reels_skip_chance = clampNumber(next.reels_skip_chance as number, 0, 100);

        return next as InstagramSettings;
    };

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/api/instagram/settings?scope=global`);
            if (!res.ok) throw new Error(`Failed to load settings: ${res.statusText}`);
            const cloud = await res.json();
            const normalized = normalizeLoadedSettings(cloud);
            setSettings(normalized);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
            return normalized;
        } catch (e) {
            setSettings(DEFAULT_SETTINGS);
            setError(e instanceof Error ? e.message : String(e));
            return DEFAULT_SETTINGS;
        } finally {
            setLoading(false);
        }
    }, []);

    const save = useCallback(async (next: InstagramSettings) => {
        setSaving(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/api/instagram/settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scope: 'global', ...next }),
            });
            if (!res.ok) throw new Error(`Failed to save settings: ${res.statusText}`);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
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
                    // Error already handled in save()
                }
            }
        };

        const p = run().finally(() => {
            saveInFlightRef.current = null;
        });

        saveInFlightRef.current = p;
    }, [save]);

    const updateSettings = useCallback((
        next: InstagramSettings | ((prev: InstagramSettings) => InstagramSettings),
        persist = true
    ) => {
        setSettings(prev => {
            const nextVal = typeof next === 'function' ? next(prev) : next;
            if (persist) {
                persistLatest(nextVal);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(nextVal));
            }
            return nextVal;
        });
    }, [persistLatest]);

    useEffect(() => {
        load();
    }, [load]);

    return { settings, loading, saving, error, load, save, updateSettings, setSettings, setError };
}
