import React, { useState, useEffect, useRef } from 'react';
import { Text, Box, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { profileManager, Profile } from '../lib/profiles.js';
import { profilesSetLoginTrue } from '../lib/supabase.js';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');

type Props = {
    onBack: () => void;
    initialProfilePickerIndex: number;
    onProfilePickerIndexChange: (index: number) => void;
};

export default function Login({ onBack, initialProfilePickerIndex, onProfilePickerIndexChange }: Props) {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [step, setStep] = useState<'select_profile' | 'enter_creds' | 'running'>('select_profile');
    const [profilePickerIndex, setProfilePickerIndex] = useState(initialProfilePickerIndex);
    const onProfilePickerIndexChangeRef = useRef(onProfilePickerIndexChange);
    const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [twoFactorSecret, setTwoFactorSecret] = useState('');
    const [headless, setHeadless] = useState(false);
    const [activeField, setActiveField] = useState<'username' | 'password' | '2fa' | 'headless' | 'button'>('username');
    const [logs, setLogs] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const processRef = useRef<ChildProcess | null>(null);
    const loginUpdatedRef = useRef(false);

    useEffect(() => {
        loadProfiles();
        return () => {
            if (processRef.current) {
                processRef.current.kill();
            }
        };
    }, []);

    useEffect(() => {
        onProfilePickerIndexChangeRef.current = onProfilePickerIndexChange;
    }, [onProfilePickerIndexChange]);

    useEffect(() => {
        onProfilePickerIndexChangeRef.current(profilePickerIndex);
    }, [profilePickerIndex]);

    const loadProfiles = async () => {
        setLoading(true);
        const data = await profileManager.getProfiles();
        // Filter profiles where login is not true (false or undefined)
        const filtered = data.filter(p => p.login !== true);
        setProfiles(filtered);
        setProfilePickerIndex(prev => {
            const max = Math.max(0, filtered.length - 1);
            const next = Math.max(0, Math.min(prev, max));
            return next;
        });
        setLoading(false);
    };

    const handleProfileSelect = (item: any) => {
        const idx = profiles.findIndex(p => p.name === item.value);
        if (idx >= 0) {
            setProfilePickerIndex(idx);
        }
        const profile = profiles.find(p => p.name === item.value);
        if (profile) {
            setSelectedProfile(profile);
            setStep('enter_creds');
        }
    };

    const startLogin = () => {
        if (!selectedProfile || !username || !password) return;
        loginUpdatedRef.current = false;
        setStep('running');
        setLogs(prev => [...prev, `Starting login for ${username} on profile ${selectedProfile.name}...`]);
        const profileName = selectedProfile.name;

        const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'login_automation.py');
        const python = process.env.PYTHON || 'python';

        const args = [
            scriptPath,
            '--profile', selectedProfile.name,
        ];

        if (headless) {
            args.push('--headless');
        }

        // Check for proxy in profile
        const proxy = (selectedProfile as any).proxy || (selectedProfile as any).proxy_string;
        if (proxy) {
            args.push('--proxy', proxy);
        }

        const proc = spawn(python, args, { stdio: 'pipe' });

        // Send credentials via stdin (not visible in process list)
        const credentials = JSON.stringify({
            username,
            password,
            two_factor_secret: twoFactorSecret || null
        });
        proc.stdin?.write(credentials);
        proc.stdin?.end();
        processRef.current = proc;

        proc.stdout?.on('data', (data) => {
            const lines = data.toString().split('\n');
            lines.forEach((line: string) => {
                const trimmed = line.trim();
                if (!trimmed) return;
                if (trimmed === '__LOGIN_SUCCESS__') {
                    if (loginUpdatedRef.current) return;
                    loginUpdatedRef.current = true;
                    void profilesSetLoginTrue(profileName)
                        .then(() => {
                            setLogs(prev => [...prev, '✅ Updated profile login status to True in DB.']);
                            setProfiles(prev => prev.filter(p => p.name !== profileName));
                        })
                        .catch((e: any) => {
                            setLogs(prev => [...prev, `⚠️ Failed to update profile login status: ${e?.message || String(e)}`]);
                        });
                    return;
                }
                setLogs(prev => [...prev, trimmed]);
            });
        });

        proc.stderr?.on('data', (data) => {
            const lines = data.toString().split('\n');
            lines.forEach((line: string) => {
                if (line.trim()) setLogs(prev => [...prev, `ERR: ${line.trim()}`]);
            });
        });

        proc.on('close', (code) => {
            setLogs(prev => [...prev, `Process exited with code ${code}`]);
            processRef.current = null;
        });
    };

    useInput((input, key) => {
        if (key.escape) {
            if (step === 'running') {
                if (processRef.current) {
                    processRef.current.kill();
                    setLogs(prev => [...prev, 'Process killed by user.']);
                }
                onBack();
            } else if (step === 'enter_creds') {
                setStep('select_profile');
            } else {
                onBack();
            }
        }

        if (step === 'enter_creds') {
            if (key.return && activeField === 'button') {
                startLogin();
            }
            if ((key.return || input === ' ') && activeField === 'headless') {
                setHeadless(!headless);
            }
            if (key.tab || key.downArrow) {
                if (activeField === 'username') setActiveField('password');
                else if (activeField === 'password') setActiveField('2fa');
                else if (activeField === '2fa') setActiveField('headless');
                else if (activeField === 'headless') setActiveField('button');
                else setActiveField('username');
            }
            if (key.upArrow) {
                if (activeField === 'button') setActiveField('headless');
                else if (activeField === 'headless') setActiveField('2fa');
                else if (activeField === '2fa') setActiveField('password');
                else if (activeField === 'password') setActiveField('username');
                else setActiveField('button');
            }
        }
    });

    if (step === 'select_profile') {
        return (
            <Box flexDirection="column">
                <Text color="green" bold>Select Profile to Login</Text>
                <Box borderStyle="single" borderColor="gray" padding={1}>
                    {loading ? <Text>Loading profiles...</Text> : (
                        <SelectInput
                            items={profiles.map(p => ({ label: p.name, value: p.name }))}
                            initialIndex={profilePickerIndex}
                            onHighlight={item => {
                                const idx = profiles.findIndex(p => p.name === item.value);
                                if (idx >= 0) {
                                    setProfilePickerIndex(idx);
                                }
                            }}
                            onSelect={handleProfileSelect}
                        />
                    )}
                </Box>
                <Text color="gray">Press Esc to go back</Text>
            </Box>
        );
    }

    if (step === 'enter_creds') {
        return (
            <Box flexDirection="column">
                <Text color="green" bold>Enter Instagram Credentials for {selectedProfile?.name}</Text>

                <Box flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
                    <Box>
                        <Text color={activeField === 'username' ? 'blue' : 'white'}>Username: </Text>
                        <TextInput
                            value={username}
                            onChange={setUsername}
                            focus={activeField === 'username'}
                        />
                    </Box>
                    <Box>
                        <Text color={activeField === 'password' ? 'blue' : 'white'}>Password: </Text>
                        <TextInput
                            value={password}
                            onChange={setPassword}
                            focus={activeField === 'password'}
                            mask="*"
                        />
                    </Box>
                    <Box>
                        <Text color={activeField === '2fa' ? 'blue' : 'white'}>2FA Secret (Optional): </Text>
                        <TextInput
                            value={twoFactorSecret}
                            onChange={setTwoFactorSecret}
                            focus={activeField === '2fa'}
                        />
                    </Box>
                    <Box marginTop={1}>
                        <Text color={activeField === 'headless' ? 'blue' : 'white'}>
                            [ {headless ? 'X' : ' '} ] Headless Mode
                        </Text>
                    </Box>
                    <Box marginTop={1}>
                        <Text color={activeField === 'button' ? 'blue' : 'gray'}>
                            {activeField === 'button' ? '> [ Start Login ] <' : '[ Start Login ]'}
                        </Text>
                    </Box>
                </Box>
                <Text color="gray">Tab/Arrows to navigate, Enter to submit, Esc to back</Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column">
            <Text color="green" bold>Login Automation Running...</Text>
            <Box borderStyle="single" borderColor="gray" padding={1} height={15} flexDirection="column">
                {logs.slice(-13).map((log, i) => (
                    <Text key={i}>{log}</Text>
                ))}
            </Box>
            <Text color="gray">Press Esc to stop/back</Text>
        </Box>
    );
}
