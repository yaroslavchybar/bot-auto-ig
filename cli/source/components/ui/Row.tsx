import React from 'react';
import { Box, Text } from 'ink';

export interface RowProps {
    label: string;
    focused: boolean;
    children: React.ReactNode;
    extra?: React.ReactNode;
}

export function Row({ label, focused, children, extra }: RowProps) {
    return (
        <Box>
            <Text color={focused ? 'cyan' : 'white'}>{focused ? '> ' : '  '}</Text>
            <Box width={22}>
                <Text color={focused ? 'cyan' : 'white'}>{label}</Text>
            </Box>
            <Box>
                {children}
                {extra ? <Box marginLeft={2}>{extra}</Box> : null}
            </Box>
        </Box>
    );
}
