import React from 'react';
import { Box, Text } from 'ink';
import { ActionName } from '../../../types/index.js';

interface OrderProps {
    visibleOrder: ActionName[];
    index: number;
}

export function OrderView({ visibleOrder, index }: OrderProps) {
    return (
        <Box flexDirection="column" padding={1}>
            <Text bold>Execution Order</Text>
            <Text color="gray">[Left/Right or Ctrl+Up/Down or Ctrl+PgUp/PgDn] Move  [A] Add  [D] Remove  [Esc] Back</Text>
            <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
                {visibleOrder.length === 0 ? (
                    <Text color="gray">No enabled actions.</Text>
                ) : (
                    visibleOrder.map((a, i) => (
                        <Text key={`${a}-${i}`} color={i === index ? 'cyan' : 'white'}>
                            {i === index ? '> ' : '  '}
                            {a}
                        </Text>
                    ))
                )}
            </Box>
        </Box>
    );
}

interface AddProps {
    candidates: ActionName[];
    index: number;
}

export function OrderAddView({ candidates, index }: AddProps) {
    return (
        <Box flexDirection="column" padding={1}>
            <Text bold>Add Action</Text>
            <Text color="gray">[Up/Down] Select  [Enter] Add  [Esc] Cancel</Text>
            <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
                {candidates.length === 0 ? (
                    <Text color="gray">No enabled actions.</Text>
                ) : (
                    candidates.map((a, i) => (
                        <Text key={`${a}-${i}`} color={i === index ? 'cyan' : 'white'}>
                            {i === index ? '> ' : '  '}
                            {a}
                        </Text>
                    ))
                )}
            </Box>
        </Box>
    );
}
