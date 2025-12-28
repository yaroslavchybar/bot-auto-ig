import React from 'react';
import { Box, Text } from 'ink';
import { Profile } from '../../../lib/profiles.js';

interface Props {
    profiles: Profile[];
    selectedIndex: number;
    runningProfiles: Set<string>;
    loading: boolean;
    error: string | null;
    lastLogs: string[];
    activeProfileName: string | null;
}

export function ListView({ profiles, selectedIndex, runningProfiles, loading, error, lastLogs, activeProfileName }: Props) {
    return (
        <Box flexDirection="column" padding={1}>
            <Box marginBottom={1}>
                <Text bold>Profiles ({profiles.length})</Text>
                <Text color="gray"> | </Text>
                <Text>[C]reate | [R]efresh | [Esc] Back</Text>
            </Box>

            {loading && <Text>Loading...</Text>}
            {error && <Text color="red">{error}</Text>}

            <Box flexDirection="column" borderStyle="single" borderColor="gray" padding={1} minHeight={10}>
                {profiles.length === 0 && !loading ? (
                    <Text>No profiles found.</Text>
                ) : (
                    profiles.map((profile, index) => {
                        const isSelected = index === selectedIndex;
                        return (
                            <Box key={profile.name || index}>
                                <Text color={isSelected ? 'green' : 'white'} wrap="truncate-end">
                                    {isSelected ? '> ' : '  '}
                                    {profile.name}
                                </Text>
                                <Box marginLeft={2}>
                                    <Text color="gray">
                                        {profile.proxy ? '🌐 Proxy' : '🏠 Direct'}
                                    </Text>
                                </Box>
                                {runningProfiles.has(profile.name) && (
                                    <Box marginLeft={2}>
                                        <Text color="yellow">⚡ Running</Text>
                                    </Box>
                                )}
                                {isSelected && (
                                    <Box marginLeft={2}>
                                        <Text color="cyan">
                                            {runningProfiles.has(profile.name) ? '[S]top ' : '[S]tart '}
                                            [E]dit [D]elete [L]ogs
                                        </Text>
                                    </Box>
                                )}
                            </Box>
                        );
                    })
                )}
            </Box>

            <Box marginTop={1} borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1} height={15}>
                <Text bold>📋 Logs: {activeProfileName || 'N/A'}</Text>
                <Box flexDirection="column">
                    {lastLogs.length === 0 ? (
                        <Text color="gray">No logs available...</Text>
                    ) : (
                        lastLogs.map((log, i) => (
                            <Text key={i} color="gray" wrap="truncate-end">{log}</Text>
                        ))
                    )}
                </Box>
            </Box>
        </Box>
    );
}
