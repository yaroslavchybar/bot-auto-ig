import React from 'react';
import { Box, Text } from 'ink';
import { ListRow } from '../../../types/index.js';

interface Props {
    lists: ListRow[];
    selectedIds: string[];
    index: number;
    error: string | null;
}

export function ListView({ lists, selectedIds, index, error }: Props) {
    return (
        <Box flexDirection="column" padding={1}>
            <Text bold>Profile Source Lists</Text>
            <Text color="gray">[Up/Down] Navigate  [Space/Enter] Toggle  [R] Refresh  [Esc] Back</Text>
            <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
                {lists.length === 0 ? (
                    <Text color="gray">No lists found.</Text>
                ) : (
                    lists.map((l, i) => {
                        const selected = selectedIds.includes(l.id);
                        const focused = i === index;
                        return (
                            <Text key={l.id} color={focused ? 'cyan' : 'white'}>
                                {focused ? '> ' : '  '}[{selected ? 'x' : ' '}] {l.name}
                            </Text>
                        );
                    })
                )}
            </Box>
            {error ? (
                <Box marginTop={1}>
                    <Text color="red">{error}</Text>
                </Box>
            ) : null}
        </Box>
    );
}
