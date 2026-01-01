import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface Props {
    profileName: string;
    step: 'enter_creds' | 'running';
    username: string;
    password: string;
    twoFactorSecret: string;
    headless: boolean;
    activeField: 'username' | 'password' | '2fa' | 'headless' | 'button';
    logs: string[];
    onUsernameChange: (value: string) => void;
    onPasswordChange: (value: string) => void;
    onTwoFactorSecretChange: (value: string) => void;
}

export function LoginView({
    profileName,
    step,
    username,
    password,
    twoFactorSecret,
    headless,
    activeField,
    logs,
    onUsernameChange,
    onPasswordChange,
    onTwoFactorSecretChange
}: Props) {
    if (step === 'running') {
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

    return (
        <Box flexDirection="column">
            <Text color="green" bold>Enter Instagram Credentials for {profileName}</Text>

            <Box flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
                <Box>
                    <Text color={activeField === 'username' ? 'blue' : 'white'}>Username: </Text>
                    <TextInput
                        value={username}
                        onChange={onUsernameChange}
                        focus={activeField === 'username'}
                    />
                </Box>
                <Box>
                    <Text color={activeField === 'password' ? 'blue' : 'white'}>Password: </Text>
                    <TextInput
                        value={password}
                        onChange={onPasswordChange}
                        focus={activeField === 'password'}
                        mask="*"
                    />
                </Box>
                <Box>
                    <Text color={activeField === '2fa' ? 'blue' : 'white'}>2FA Secret (Optional): </Text>
                    <TextInput
                        value={twoFactorSecret}
                        onChange={onTwoFactorSecretChange}
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
