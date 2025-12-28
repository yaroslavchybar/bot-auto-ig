import React from 'react';
import { Text, Box } from 'ink';
import { List } from '../hooks/useLists.js';

interface Props {
    lists: List[];
    selectedIndex: number;
    loading: boolean;
    error: string | null;
}

export function ListView({ lists, selectedIndex, loading, error }: Props) {
    return (
        <Box flexDirection="column" padding={1}>
            <Text bold>Lists Manager</Text>
            <Text color="gray">[N] New List  [E] Edit  [D] Delete  [Esc] Back</Text>

            <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
                {loading ? (
                    <Text>Loading...</Text>
                ) : error ? (
                    <Text color="red">Error: {error}</Text>
                ) : lists.length === 0 ? (
                    <Text>No lists found.</Text>
                ) : (
                    lists.map((list, index) => (
                        <Box key={list.id}>
                            <Text color={index === selectedIndex ? 'cyan' : 'white'}>
                                {index === selectedIndex ? '> ' : '  '} {list.name}
                            </Text>
                        </Box>
                    ))
                )}
            </Box>
        </Box>
    );
}
