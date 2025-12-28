import React from 'react';
import { Box, Text } from 'ink';

interface LogsProps {
    name: string;
    logs: string[];
    copyFeedback: string | null;
}

export function LogsView({ name, logs, copyFeedback }: LogsProps) {
    return (
        <Box flexDirection="column" padding={1}>
            <Box marginBottom={1}>
                <Text bold>📝 Full Logs: {name}</Text>
                <Text color="gray"> | </Text>
                <Text>[Esc] Back | [C]opy Logs</Text>
                {copyFeedback && <Text color="green"> {copyFeedback}</Text>}
            </Box>
            <Box flexDirection="column" borderStyle="single" borderColor="gray" padding={1} minHeight={20}>
                {logs.length === 0 ? (
                    <Text color="gray">No logs available.</Text>
                ) : (
                    logs.map((log, i) => (
                        <Text key={i}>{log}</Text>
                    ))
                )}
            </Box>
        </Box>
    );
}

interface DeleteProps {
    name: string;
}

export function DeleteView({ name }: DeleteProps) {
    return (
        <Box flexDirection="column" padding={1} borderColor="red" borderStyle="single">
            <Text bold color="red">Delete Profile</Text>
            <Box marginTop={1}>
                <Text>Are you sure you want to delete profile </Text>
                <Text bold color="yellow">{name}</Text>
                <Text>?</Text>
            </Box>
            <Box marginTop={1}>
                <Text color="gray">[Y]es / [N]o / [Esc] Cancel</Text>
            </Box>
        </Box>
    );
}
