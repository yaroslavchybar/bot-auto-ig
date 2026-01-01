import { useState, useEffect, useCallback, useRef } from 'react';
import { profileManager, Profile } from '../../../lib/profiles.js';
import { manualAutomationService } from '../../../lib/manualAutomationService.js';

export function useProfiles() {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [runningProfiles, setRunningProfiles] = useState<Set<string>>(manualAutomationService.runningNames);
    const [profileLogs, setProfileLogs] = useState<Map<string, string[]>>(new Map());

    const logBuffersRef = useRef<Map<string, string>>(new Map());
    const pendingLinesRef = useRef<Map<string, string[]>>(new Map());

    const flushPending = useCallback(() => {
        const pending = pendingLinesRef.current;
        if (pending.size === 0) return;

        const entries = Array.from(pending.entries());
        pending.clear();

        setProfileLogs(prev => {
            const next = new Map(prev);
            for (const [name, lines] of entries) {
                const currentLogs = next.get(name) || [];
                const newLogs = [...currentLogs, ...lines].slice(-1000);
                next.set(name, newLogs);
            }
            return next;
        });
    }, []);

    const addLogChunk = useCallback((name: string, message: string) => {
        const normalized = String(message).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const buffers = logBuffersRef.current;
        const pending = pendingLinesRef.current;

        const existing = buffers.get(name) || '';
        const combined = existing + normalized;
        const parts = combined.split('\n');
        const remainder = parts.pop() || '';
        buffers.set(name, remainder.length > 10000 ? remainder.slice(-10000) : remainder);

        const lines = parts.filter(l => l.trim().length > 0);
        if (lines.length === 0) return;

        const currentPending = pending.get(name) || [];
        const merged = [...currentPending, ...lines];
        pending.set(name, merged.length > 2000 ? merged.slice(-2000) : merged);
    }, []);

    useEffect(() => {
        const id = setInterval(flushPending, 75);
        return () => clearInterval(id);
    }, [flushPending]);

    useEffect(() => {
        const onChange = (names: Set<string>) => setRunningProfiles(new Set(names));
        const onLog = ({ name, message }: any) => addLogChunk(name, message);
        const onError = ({ name, message }: any) => setError(`${name}: ${message}`);

        manualAutomationService.on('change', onChange);
        manualAutomationService.on('log', onLog);
        manualAutomationService.on('error', onError);

        return () => {
            manualAutomationService.off('change', onChange);
            manualAutomationService.off('log', onLog);
            manualAutomationService.off('error', onError);
        };
    }, [addLogChunk]);

    const loadProfiles = useCallback(async () => {
        setLoading(true);
        try {
            const data = await profileManager.getProfiles();
            setProfiles(data);
            return data;
        } catch (e: any) {
            setError(e.message);
            return [];
        } finally {
            setLoading(false);
        }
    }, []);

    const toggleProfile = useCallback((profile: Profile) => {
        const name = profile.name;
        if (manualAutomationService.isRunning(name)) {
            manualAutomationService.stop(name);
        } else {
            manualAutomationService.start(profile).catch(err => {
                setError(err.message);
            });
        }
    }, []);

    useEffect(() => {
        loadProfiles();
    }, [loadProfiles]);

    return { profiles, loading, error, runningProfiles, profileLogs, loadProfiles, toggleProfile, setError };
}
