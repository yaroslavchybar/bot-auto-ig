import React from 'react';
import { Box, Text } from 'ink';

interface Props {
    current: number;
    total: number;
    label: string;
    width?: number;
}

export function ProgressBar({ current, total, label, width = 20 }: Props) {
    const pct = Math.round(total > 0 ? (current / total) * 100 : 0);
    const filledCount = Math.round(total > 0 ? (current / total) * width : 0);
    const filled = '█'.repeat(Math.max(0, Math.min(width, filledCount)));
    const empty = '░'.repeat(Math.max(0, width - filledCount));

    return (
        <Box>
            <Text>{label}: </Text>
            <Text color="green">{filled}</Text>
            <Text color="gray">{empty}</Text>
            <Text> {pct}% ({current}/{total})</Text>
        </Box>
    );
}
