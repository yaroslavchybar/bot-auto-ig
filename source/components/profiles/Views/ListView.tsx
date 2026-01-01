import React from 'react';
import { Box, Text } from 'ink';
import { Profile } from '../../../lib/profiles.js';

interface Props {
    loggedInProfiles: Profile[];
    notLoggedInProfiles: Profile[];
    selectedIndex: number;
    runningProfiles: Set<string>;
    loading: boolean;
    error: string | null;
    lastLogs: string[];
    activeProfileName: string | null;
}

export function ListView({ loggedInProfiles, notLoggedInProfiles, selectedIndex, runningProfiles, loading, error, lastLogs, activeProfileName }: Props) {
    const total = loggedInProfiles.length + notLoggedInProfiles.length;
    return (
        <Box flexDirection="column" padding={1}>
            <Box marginBottom={1}>
                <Text bold>Profiles ({total})</Text>
                <Text color="gray"> | </Text>
                <Text>[C]reate | [R]efresh | [Esc] Back</Text>
            </Box>

            {loading && <Text>Loading...</Text>}
            {error && <Text color="red">{error}</Text>}

            <Box flexDirection="column" borderStyle="single" borderColor="gray" padding={1} minHeight={10}>
                {total === 0 && !loading ? (
                    <Text>No profiles found.</Text>
                ) : (
                    <>
                        <Text color="blue" bold>Logged in ({loggedInProfiles.length})</Text>
                        {loggedInProfiles.map((profile, index) => {
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
                                                {runningProfiles.has(profile.name)
                                                    ? '[S]top [E]dit [D]elete [L]ogs'
                                                    : '[S]tart [E]dit [D]elete [L]ogs'}
                                            </Text>
                                        </Box>
                                    )}
                                </Box>
                            );
                        })}

                        <Text color="blue" bold>Not logged in ({notLoggedInProfiles.length})</Text>
                        {notLoggedInProfiles.map((profile, index) => {
                            const combinedIndex = loggedInProfiles.length + index;
                            const isSelected = combinedIndex === selectedIndex;
                            return (
                                <Box key={profile.name || combinedIndex}>
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
                                            <Text color="cyan">[L]ogin [E]dit [D]elete</Text>
                                        </Box>
                                    )}
                                </Box>
                            );
                        })}
                    </>
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
