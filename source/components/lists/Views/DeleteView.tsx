import React from 'react';
import { Text, Box } from 'ink';

interface Props {
    listName: string | undefined;
}

export function DeleteView({ listName }: Props) {
    return (
        <Box flexDirection="column" padding={1} borderColor="red" borderStyle="single">
            <Text bold color="red">Delete List</Text>
            <Box marginTop={1}>
                <Text>Are you sure you want to delete list </Text>
                <Text bold color="yellow">{listName}</Text>
                <Text>?</Text>
            </Box>
            <Box marginTop={1}>
                <Text color="gray">[Y]es / [N]o / [Esc] Cancel</Text>
            </Box>
        </Box>
    );
}
