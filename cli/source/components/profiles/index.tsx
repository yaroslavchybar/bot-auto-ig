import React, { useState, useEffect, useRef } from 'react';
import { useInput } from 'ink';
import clipboardy from 'clipboardy';
import { profileManager, Profile } from '../../lib/profiles.js';
import { getRandomUserAgent } from '../../lib/user_agents.js';
import { clamp } from '../../lib/utils.js';

import { useProfiles } from './hooks/useProfiles.js';
import { ListView } from './Views/ListView.js';
import { FormView } from './Views/FormView.js';
import { DeleteView, LogsView } from './Views/MiscViews.js';

type Props = {
    onBack: () => void;
    initialSelectedIndex: number;
    onSelectedIndexChange: (index: number) => void;
};

export default function Profiles({ onBack, initialSelectedIndex, onSelectedIndexChange }: Props) {
    const {
        profiles,
        loading,
        error,
        runningProfiles,
        profileLogs,
        loadProfiles,
        toggleProfile,
        setError
    } = useProfiles();

    const [selectedIndex, setSelectedIndex] = useState(initialSelectedIndex);
    const [mode, setMode] = useState<'list' | 'create' | 'edit' | 'delete' | 'logs'>('list');
    const [formData, setFormData] = useState<Partial<Profile>>({});
    const [activeField, setActiveField] = useState(0);
    const [isEditingSelect, setIsEditingSelect] = useState(false);
    const [selectIndexByKey, setSelectIndexByKey] = useState<Record<string, number>>({});
    const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

    const onSelectedIndexChangeRef = useRef(onSelectedIndexChange);

    useEffect(() => {
        onSelectedIndexChangeRef.current = onSelectedIndexChange;
    }, [onSelectedIndexChange]);

    useEffect(() => {
        onSelectedIndexChangeRef.current(selectedIndex);
    }, [selectedIndex]);

    const getFields = () => {
        const isProxy = (formData as any).connection === 'proxy';
        return [
            { key: 'name', label: 'Name', type: 'text' },
            {
                key: 'type', label: 'Browser Type', type: 'select', options: [
                    { label: 'Camoufox (Recommended)', value: 'Camoufox (рекомендуется)' },
                    { label: 'Standard Firefox', value: 'Standard Firefox' }
                ]
            },
            {
                key: 'connection', label: 'Connection', type: 'select', options: [
                    { label: 'Direct Connection', value: 'direct' },
                    { label: 'Use Proxy', value: 'proxy' }
                ]
            },
            ...(isProxy ? [
                {
                    key: 'proxy_type', label: 'Proxy Type', type: 'select', options: [
                        { label: 'HTTP', value: 'http' },
                        { label: 'HTTPS', value: 'https' },
                        { label: 'SOCKS4', value: 'socks4' },
                        { label: 'SOCKS5', value: 'socks5' },
                        { label: 'SSH', value: 'ssh' }
                    ]
                },
                { key: 'proxy', label: 'Proxy (ip:port:user:pass)', type: 'text' }
            ] : []),
            {
                key: 'ua_os', label: 'UA OS', type: 'select', options: [
                    { label: 'Any', value: 'Любая' },
                    { label: 'Windows', value: 'Windows' },
                    { label: 'macOS', value: 'macOS' },
                    { label: 'Linux', value: 'Linux' }
                ]
            },
            {
                key: 'ua_browser', label: 'UA Browser', type: 'select', options: [
                    { label: 'Firefox (Recommended)', value: 'Firefox' },
                    { label: 'Chrome', value: 'Chrome' },
                    { label: 'Safari', value: 'Safari' }
                ]
            },
            { key: 'user_agent', label: 'User Agent', type: 'text' },
            { key: 'regen_ua', label: 'Regenerate User Agent', type: 'button' },
            { key: 'test_ip', label: 'Test IP', type: 'toggle' },
            { key: 'save', label: 'Save Profile', type: 'button' },
            { key: 'cancel', label: 'Cancel', type: 'button' }
        ];
    };

    const saveProfile = async () => {
        setError(null);
        try {
            if (!formData.name) throw new Error("Name is required");

            const finalData = { ...formData };
            if ((finalData as any).connection === 'proxy' && finalData.proxy) {
                const pType = (finalData as any).proxy_type || 'http';
                let pVal = finalData.proxy;
                if (pVal.includes('://')) pVal = pVal.split('://')[1]!;
                finalData.proxy = `${pType}://${pVal}`;
            } else if ((finalData as any).connection === 'direct') {
                finalData.proxy = '';
                (finalData as any).proxy_type = null;
            }

            delete (finalData as any).connection;

            if (mode === 'create') {
                await profileManager.createProfile(finalData as Profile);
            } else {
                await profileManager.updateProfile(profiles[selectedIndex]?.name!, finalData as Profile);
            }
            await loadProfiles();
            setMode('list');
        } catch (e: any) {
            setError(e.message);
        }
    };

    useInput((input, key) => {
        if (loading) return;

        if (mode === 'list') {
            if (key.escape) { onBack(); return; }
            if (key.upArrow) setSelectedIndex(prev => clamp(prev - 1, 0, Math.max(0, profiles.length - 1)));
            if (key.downArrow) setSelectedIndex(prev => clamp(prev + 1, 0, Math.max(0, profiles.length - 1)));
            if (input === 'c') {
                setMode('create');
                setFormData({
                    name: '',
                    type: 'Camoufox (рекомендуется)',
                    proxy: '',
                    // @ts-ignore
                    connection: 'direct',
                    // @ts-ignore
                    proxy_type: 'http',
                    ua_os: 'Windows',
                    ua_browser: 'Firefox',
                    user_agent: getRandomUserAgent('Windows', 'Firefox'),
                    test_ip: false
                });
                setActiveField(0);
                setIsEditingSelect(false);
            }
            if (input === 'r') loadProfiles();
            if (profiles.length > 0) {
                const p = profiles[selectedIndex];
                if (!p) return;
                if (input === 'e') {
                    setMode('edit');
                    let pType = 'http';
                    let pVal = p.proxy || '';
                    if (pVal.includes('://')) {
                        const parts = pVal.split('://');
                        pType = parts[0]!;
                        pVal = parts[1]!;
                    }
                    setFormData({
                        ...p,
                        proxy: pVal,
                        ua_os: p.ua_os || 'Windows',
                        ua_browser: p.ua_browser || 'Firefox',
                        // @ts-ignore
                        connection: p.proxy ? 'proxy' : 'direct',
                        // @ts-ignore
                        proxy_type: (p as any).proxy_type || pType
                    });
                    setActiveField(0);
                    setIsEditingSelect(false);
                }
                if (input === 'd') setMode('delete');
                if (input === 's') toggleProfile(p);
                if (input === 'l') setMode('logs');
            }
        } else if (mode === 'create' || mode === 'edit') {
            const fields = getFields();
            const field = fields[activeField]!;
            if (isEditingSelect) {
                if (key.escape) setIsEditingSelect(false);
                return;
            }
            if (key.escape) { setMode('list'); setError(null); return; }
            if (key.upArrow) setActiveField(Math.max(0, activeField - 1));
            if (key.downArrow) setActiveField(Math.min(fields.length - 1, activeField + 1));
            if (key.return) {
                if (field.type === 'select') setIsEditingSelect(true);
                else if (field.type === 'toggle') setFormData(prev => ({ ...prev, test_ip: !prev.test_ip }));
                else if (field.key === 'regen_ua') {
                    const ua = getRandomUserAgent(formData.ua_os, formData.ua_browser);
                    setFormData(prev => ({ ...prev, user_agent: ua }));
                }
                else if (field.key === 'save') saveProfile();
                else if (field.key === 'cancel') { setMode('list'); setError(null); }
            }
            if (field.type === 'toggle' && input === ' ') setFormData(prev => ({ ...prev, test_ip: !prev.test_ip }));
        } else if (mode === 'delete') {
            if (key.escape || input === 'n') setMode('list');
            if (key.return || input === 'y') {
                const p = profiles[selectedIndex];
                if (p?.name) {
                    profileManager.deleteProfile(p.name).then(() => {
                        loadProfiles();
                        setMode('list');
                    });
                }
            }
        } else if (mode === 'logs') {
            if (key.escape) { setMode('list'); setCopyFeedback(null); }
            if (input === 'c') {
                const currentLogs = profileLogs.get(profiles[selectedIndex]?.name!) || [];
                if (currentLogs.length > 0) {
                    clipboardy.writeSync(currentLogs.join('\n'));
                    setCopyFeedback('Copied to clipboard!');
                    setTimeout(() => setCopyFeedback(null), 2000);
                }
            }
        }
    });

    if (mode === 'list') {
        const p = profiles[selectedIndex];
        return (
            <ListView
                profiles={profiles}
                selectedIndex={selectedIndex}
                runningProfiles={runningProfiles}
                loading={loading}
                error={error}
                lastLogs={(profileLogs.get(p?.name!) || []).slice(-10)}
                activeProfileName={p?.name || null}
            />
        );
    }

    if (mode === 'create' || mode === 'edit') {
        return (
            <FormView
                mode={mode}
                formData={formData}
                activeField={activeField}
                isEditingSelect={isEditingSelect}
                selectIndexByKey={selectIndexByKey}
                error={error}
                fields={getFields()}
                onSetFormData={setFormData}
                onSetIsEditingSelect={setIsEditingSelect}
                onSetSelectIndexByKey={setSelectIndexByKey}
            />
        );
    }

    if (mode === 'delete') {
        return <DeleteView name={profiles[selectedIndex]?.name!} />;
    }

    if (mode === 'logs') {
        return <LogsView name={profiles[selectedIndex]?.name!} logs={profileLogs.get(profiles[selectedIndex]?.name!) || []} copyFeedback={copyFeedback} />;
    }

    return null;
}
