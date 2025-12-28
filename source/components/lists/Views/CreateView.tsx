import React from 'react';
import { Text, Box } from 'ink';
import TextInput from 'ink-text-input';

interface Props {
    inputName: string;
    onInputChange: (value: string) => void;
    onSubmit: () => void;
}

export function CreateView({ inputName, onInputChange, onSubmit }: Props) {
    return (
        <Box flexDirection="column" padding={1}>
            <Text bold>Create New List</Text>
            <Box marginTop={1}>
                <Text>Name: </Text>
                <TextInput value={inputName} onChange={onInputChange} onSubmit={onSubmit} />
            </Box>
            <Box marginTop={1}>
                <Text color="gray">[Enter] Save  [Esc] Cancel</Text>
            </Box>
        </Box>
    );
}
