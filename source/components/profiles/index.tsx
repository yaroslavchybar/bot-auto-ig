import React, { useState, useEffect, useRef } from 'react';
import { useInput } from 'ink';
import clipboardy from 'clipboardy';
import { spawn, ChildProcess, execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { profileManager, Profile } from '../../lib/profiles.js';
import { profilesSetLoginTrue } from '../../lib/supabase.js';
import { getRandomUserAgent } from '../../lib/user_agents.js';
import { clamp } from '../../lib/utils.js';

import { useProfiles } from './hooks/useProfiles.js';
import { ListView } from './Views/ListView.js';
import { FormView } from './Views/FormView.js';
import { DeleteView, LogsView } from './Views/MiscViews.js';
import { LoginView } from './Views/LoginView.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../../');

type Props = {
    onBack: () => void;
    initialSelectedProfileName?: string | null;
    onSelectedProfileNameChange?: (name: string | null) => void;
    initialSelectedIndex?: number;
    onSelectedIndexChange?: (index: number) => void;
};

export default function Profiles({
    onBack,
    initialSelectedProfileName = null,
    onSelectedProfileNameChange,
    initialSelectedIndex = 0,
    onSelectedIndexChange
}: Props) {
    const {
        profiles,
        loading,
        error,
        runningProfiles,
        profileLogs,
        appendProfileLog,
        loadProfiles,
        toggleProfile,
        setError
    } = useProfiles();

    const loggedInProfiles = profiles.filter(p => p.login === true);
    const notLoggedInProfiles = profiles.filter(p => p.login !== true);
    const displayProfiles = [...loggedInProfiles, ...notLoggedInProfiles];

    const [selectedIndex, setSelectedIndex] = useState(initialSelectedIndex);
    const [selectedProfileName, setSelectedProfileName] = useState<string | null>(initialSelectedProfileName);
    const [mode, setMode] = useState<'list' | 'create' | 'edit' | 'delete' | 'logs' | 'login'>('list');
    const [formData, setFormData] = useState<Partial<Profile>>({});
    const [activeField, setActiveField] = useState(0);
    const [isEditingSelect, setIsEditingSelect] = useState(false);
    const [selectIndexByKey, setSelectIndexByKey] = useState<Record<string, number>>({});
    const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
    const copyFeedbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Login mode state
    const [loginStep, setLoginStep] = useState<'enter_creds' | 'running'>('enter_creds');
    const [loginUsername, setLoginUsername] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [loginTwoFactorSecret, setLoginTwoFactorSecret] = useState('');
    const [loginHeadless, setLoginHeadless] = useState(false);
    const [loginActiveField, setLoginActiveField] = useState<'username' | 'password' | '2fa' | 'headless' | 'button'>('username');
    const [loginLogs, setLoginLogs] = useState<string[]>([]);
    const loginProcessRef = useRef<ChildProcess | null>(null);
    const loginRunningProfileNameRef = useRef<string | null>(null);
    const loginUpdatedRef = useRef(false);

    const onSelectedIndexChangeRef = useRef(onSelectedIndexChange);
    const onSelectedProfileNameChangeRef = useRef(onSelectedProfileNameChange);

    useEffect(() => {
        onSelectedIndexChangeRef.current = onSelectedIndexChange;
        onSelectedProfileNameChangeRef.current = onSelectedProfileNameChange;
    }, [onSelectedIndexChange, onSelectedProfileNameChange]);

    useEffect(() => {
        onSelectedIndexChangeRef.current?.(selectedIndex);
    }, [selectedIndex]);

    useEffect(() => {
        onSelectedProfileNameChangeRef.current?.(selectedProfileName);
    }, [selectedProfileName]);

    useEffect(() => {
        if (displayProfiles.length === 0) {
            if (selectedProfileName !== null) setSelectedProfileName(null);
            if (selectedIndex !== 0) setSelectedIndex(0);
            return;
        }

        if (selectedProfileName) {
            const idx = displayProfiles.findIndex(p => p.name === selectedProfileName);
            if (idx >= 0) {
                if (idx !== selectedIndex) setSelectedIndex(idx);
                return;
            }
        }

        const clampedIndex = clamp(selectedIndex, 0, displayProfiles.length - 1);
        const nextName = displayProfiles[clampedIndex]?.name ?? null;
        if (clampedIndex !== selectedIndex) setSelectedIndex(clampedIndex);
        if (nextName !== selectedProfileName) setSelectedProfileName(nextName);
    }, [displayProfiles, selectedProfileName, selectedIndex]);

    useEffect(() => {
        return () => {
            if (copyFeedbackTimeoutRef.current) {
                clearTimeout(copyFeedbackTimeoutRef.current);
                copyFeedbackTimeoutRef.current = null;
            }
            if (loginProcessRef.current) {
                killLoginProcess(loginProcessRef.current);
            }
        };
    }, []);

    const killLoginProcess = (proc: ChildProcess) => {
        try {
            if (process.platform === 'win32') {
                try { proc.kill('SIGBREAK'); } catch { }
                setTimeout(() => {
                    if (proc.exitCode !== null) return;
                    try { proc.kill(); } catch { }
                    setTimeout(() => {
                        if (proc.exitCode !== null) return;
                        if (typeof proc.pid === 'number') {
                            execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => { });
                        }
                    }, 1500);
                }, 500);
            } else {
                try { proc.kill('SIGTERM'); } catch { }
                setTimeout(() => {
                    if (proc.exitCode !== null) return;
                    try { proc.kill('SIGKILL'); } catch { }
                }, 1500);
            }
        } catch {
        }
    };

    const startLoginAutomation = () => {
        const p = displayProfiles[selectedIndex];
        if (!p) return false;
        if (!loginUsername || !loginPassword) {
            setError('Username and password are required for login.');
            return false;
        }

        const pushLoginLog = (line: string) => {
            setLoginLogs(prev => [...prev, line]);
            appendProfileLog(p.name, line);
        };

        loginUpdatedRef.current = false;
        loginRunningProfileNameRef.current = p.name;
        setLoginStep('running');
        pushLoginLog(`Starting login for ${loginUsername} on profile ${p.name}...`);
        const profileName = p.name;

        const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'login_automation.py');
        const python = process.env.PYTHON || 'python';

        const args = [scriptPath, '--profile', p.name];
        if (loginHeadless) args.push('--headless');
        const proxy = (p as any).proxy || (p as any).proxy_string;
        if (proxy) args.push('--proxy', proxy);

        const proc = spawn(python, args, { stdio: 'pipe', env: { ...process.env, PYTHONUNBUFFERED: '1' }, detached: process.platform === 'win32' });

        const credentials = JSON.stringify({
            username: loginUsername,
            password: loginPassword,
            two_factor_secret: loginTwoFactorSecret || null
        });
        proc.stdin?.write(credentials);
        proc.stdin?.end();
        loginProcessRef.current = proc;

        let stdoutBuf = '';
        proc.stdout?.on('data', (data) => {
            stdoutBuf += data.toString();
            const parts = stdoutBuf.split(/\r?\n/);
            stdoutBuf = parts.pop() ?? '';
            for (const line of parts) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                if (trimmed === '__LOGIN_SUCCESS__') {
                    if (loginUpdatedRef.current) continue;
                    loginUpdatedRef.current = true;
                    void profilesSetLoginTrue(profileName)
                        .then(() => {
                            pushLoginLog('Updated profile login status to True in DB.');
                            loadProfiles();
                        })
                        .catch((e: any) => {
                            pushLoginLog(`⚠️ Failed to update profile login status: ${e?.message || String(e)}`);
                        });
                    continue;
                }
                pushLoginLog(trimmed);
            }
        });

        let stderrBuf = '';
        proc.stderr?.on('data', (data) => {
            stderrBuf += data.toString();
            const parts = stderrBuf.split(/\r?\n/);
            stderrBuf = parts.pop() ?? '';
            for (const line of parts) {
                if (line.trim()) pushLoginLog(`ERR: ${line.trim()}`);
            }
        });

        proc.on('close', (code) => {
            pushLoginLog(`Process exited with code ${code}`);
            loginProcessRef.current = null;
            loginRunningProfileNameRef.current = null;
        });

        return true;
    };

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
                const targetName = selectedProfileName || displayProfiles[selectedIndex]?.name;
                if (!targetName) throw new Error('No profile selected');
                await profileManager.updateProfile(targetName, finalData as Profile);
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
            if (key.upArrow) {
                setSelectedIndex(prev => {
                    const next = clamp(prev - 1, 0, Math.max(0, displayProfiles.length - 1));
                    setSelectedProfileName(displayProfiles[next]?.name ?? null);
                    return next;
                });
            }
            if (key.downArrow) {
                setSelectedIndex(prev => {
                    const next = clamp(prev + 1, 0, Math.max(0, displayProfiles.length - 1));
                    setSelectedProfileName(displayProfiles[next]?.name ?? null);
                    return next;
                });
            }
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
            if (displayProfiles.length > 0) {
                const p = displayProfiles[selectedIndex];
                if (!p) return;
                if (p.name !== selectedProfileName) setSelectedProfileName(p.name);
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
                // 's' only works for logged-in profiles or to stop running ones
                if (input === 's') {
                    if (runningProfiles.has(p.name) || p.login === true) {
                        toggleProfile(p);
                    }
                }
                // 'l' for logs if logged in, or start login flow if not logged in
                if (input === 'l') {
                    if (p.login === true) {
                        setMode('logs');
                    } else {
                        if (loginProcessRef.current && loginRunningProfileNameRef.current === p.name) {
                            setMode('login');
                            setLoginStep('running');
                            return;
                        }
                        // Start login flow
                        setMode('login');
                        setLoginStep('enter_creds');
                        setLoginUsername('');
                        setLoginPassword('');
                        setLoginTwoFactorSecret('');
                        setLoginHeadless(false);
                        setLoginActiveField('username');
                        setLoginLogs([]);
                    }
                }
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
                const targetName = selectedProfileName || displayProfiles[selectedIndex]?.name;
                if (targetName) {
                    profileManager.deleteProfile(targetName).then(() => {
                        loadProfiles();
                        setMode('list');
                    });
                }
            }
        } else if (mode === 'logs') {
            if (key.escape) {
                setMode('list');
                setCopyFeedback(null);
                if (copyFeedbackTimeoutRef.current) {
                    clearTimeout(copyFeedbackTimeoutRef.current);
                    copyFeedbackTimeoutRef.current = null;
                }
            }
            if (input === 'c') {
                const name = selectedProfileName || displayProfiles[selectedIndex]?.name;
                const currentLogs = name ? (profileLogs.get(name) || []) : [];
                if (currentLogs.length > 0) {
                    clipboardy.writeSync(currentLogs.join('\n'));
                    setCopyFeedback('Copied to clipboard!');
                    if (copyFeedbackTimeoutRef.current) {
                        clearTimeout(copyFeedbackTimeoutRef.current);
                    }
                    copyFeedbackTimeoutRef.current = setTimeout(() => {
                        copyFeedbackTimeoutRef.current = null;
                        setCopyFeedback(null);
                    }, 2000);
                }
            }
        } else if (mode === 'login') {
            if (key.escape) {
                if (loginStep === 'running') {
                    if (loginProcessRef.current) {
                        killLoginProcess(loginProcessRef.current);
                        loginRunningProfileNameRef.current = null;
                        const profileName = selectedProfileName || displayProfiles[selectedIndex]?.name;
                        if (profileName) appendProfileLog(profileName, 'Process killed by user.');
                        setLoginLogs(prev => [...prev, 'Process killed by user.']);
                    }
                }
                setMode('list');
                setLoginStep('enter_creds');
            }
            if (loginStep === 'enter_creds') {
                if (key.return && loginActiveField === 'button') {
                    const started = startLoginAutomation();
                    if (started) setMode('list');
                }
                if ((key.return || input === ' ') && loginActiveField === 'headless') {
                    setLoginHeadless(!loginHeadless);
                }
                if (key.tab || key.downArrow) {
                    if (loginActiveField === 'username') setLoginActiveField('password');
                    else if (loginActiveField === 'password') setLoginActiveField('2fa');
                    else if (loginActiveField === '2fa') setLoginActiveField('headless');
                    else if (loginActiveField === 'headless') setLoginActiveField('button');
                    else setLoginActiveField('username');
                }
                if (key.upArrow) {
                    if (loginActiveField === 'button') setLoginActiveField('headless');
                    else if (loginActiveField === 'headless') setLoginActiveField('2fa');
                    else if (loginActiveField === '2fa') setLoginActiveField('password');
                    else if (loginActiveField === 'password') setLoginActiveField('username');
                    else setLoginActiveField('button');
                }
            }
        }
    });

    if (mode === 'list') {
        const p = displayProfiles[selectedIndex];
        const pName = p?.name;
        return (
            <ListView
                loggedInProfiles={loggedInProfiles}
                notLoggedInProfiles={notLoggedInProfiles}
                selectedIndex={selectedIndex}
                runningProfiles={runningProfiles}
                loading={loading}
                error={error}
                lastLogs={pName ? (profileLogs.get(pName) || []).slice(-10) : []}
                activeProfileName={pName || null}
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
        const name = selectedProfileName || displayProfiles[selectedIndex]?.name || '';
        return <DeleteView name={name} />;
    }

    if (mode === 'logs') {
        const name = selectedProfileName || displayProfiles[selectedIndex]?.name || '';
        return <LogsView name={name} logs={profileLogs.get(name) || []} copyFeedback={copyFeedback} />;
    }

    if (mode === 'login') {
        const p = displayProfiles[selectedIndex];
        return (
            <LoginView
                profileName={p?.name || ''}
                step={loginStep}
                username={loginUsername}
                password={loginPassword}
                twoFactorSecret={loginTwoFactorSecret}
                headless={loginHeadless}
                activeField={loginActiveField}
                logs={loginLogs}
                onUsernameChange={setLoginUsername}
                onPasswordChange={setLoginPassword}
                onTwoFactorSecretChange={setLoginTwoFactorSecret}
            />
        );
    }

    return null;
}
