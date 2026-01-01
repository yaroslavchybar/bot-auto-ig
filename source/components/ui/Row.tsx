import React from 'react';
import { Box, Text } from 'ink';

interface RowProps {
    label: string;
    focused: boolean;
    children: React.ReactNode;
}

export function Row({ label, focused, children }: RowProps) {
    return (
        <Box>
            <Text color={focused ? 'cyan' : 'white'}>{focused ? '> ' : '  '}</Text>
            <Box width={22}>
                <Text color={focused ? 'cyan' : 'white'}>{label}</Text>
            </Box>
            <Box>
                {children}
            </Box>
        </Box>
    );
}
