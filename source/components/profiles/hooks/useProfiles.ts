import { useState, useEffect, useCallback } from 'react';
import { profileManager, Profile } from '../../../lib/profiles.js';
import { manualAutomationService } from '../../../lib/manualAutomationService.js';

export function useProfiles() {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [runningProfiles, setRunningProfiles] = useState<Set<string>>(manualAutomationService.runningNames);
    const [profileLogs, setProfileLogs] = useState<Map<string, string[]>>(new Map());

    const addLog = useCallback((name: string, message: string) => {
        setProfileLogs(prev => {
            const next = new Map(prev);
            const currentLogs = next.get(name) || [];
            const lines = message.split('\n').filter(l => l.trim().length > 0);
            const newLogs = [...currentLogs, ...lines].slice(-1000);
            next.set(name, newLogs);
            return next;
        });
    }, []);

    useEffect(() => {
        const onChange = (names: Set<string>) => setRunningProfiles(new Set(names));
        const onLog = ({ name, message }: any) => addLog(name, message);
        const onError = ({ name, message }: any) => setError(`${name}: ${message}`);

        manualAutomationService.on('change', onChange);
        manualAutomationService.on('log', onLog);
        manualAutomationService.on('error', onError);

        return () => {
            manualAutomationService.off('change', onChange);
            manualAutomationService.off('log', onLog);
            manualAutomationService.off('error', onError);
        };
    }, [addLog]);

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
