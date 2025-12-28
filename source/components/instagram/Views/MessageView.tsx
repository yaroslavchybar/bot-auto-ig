import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface Props {
    mode: 'list' | 'create' | 'edit' | 'delete';
    kind: 'message' | 'message_2';
    lines: string[];
    index: number;
    draft: string;
    onDraftChange: (v: string) => void;
    onSubmitDraft: (v: string) => void;
}

export function MessageView({ mode, kind, lines, index, draft, onDraftChange, onSubmitDraft }: Props) {
    if (mode === 'delete') {
        return (
            <Box flexDirection="column" padding={1} borderStyle="single" borderColor="red">
                <Text bold color="red">
                    Delete Message
                </Text>
                <Box marginTop={1}>
                    <Text>Delete: </Text>
                    <Text color="yellow">{lines[index] || ''}</Text>
                </Box>
                <Box marginTop={1}>
                    <Text color="gray">[Y]es / [N]o / [Esc] Cancel</Text>
                </Box>
            </Box>
        );
    }

    if (mode === 'create' || mode === 'edit') {
        return (
            <Box flexDirection="column" padding={1}>
                <Text bold>{mode === 'create' ? 'Add Message' : 'Edit Message'}</Text>
                <Text color="gray">[Enter] Save  [Esc] Cancel</Text>
                <Box marginTop={1}>
                    <Text>Text: </Text>
                    <TextInput
                        value={draft}
                        onChange={onDraftChange}
                        onSubmit={onSubmitDraft}
                    />
                </Box>
            </Box>
        );
    }

    return (
        <Box flexDirection="column" padding={1}>
            <Text bold>Message Templates</Text>
            <Text color="gray">[1]/[2] Kind  [A] Add  [E] Edit  [D] Delete  [S] Save  [Esc] Back</Text>
            <Box marginTop={1}>
                <Text>
                    Kind: <Text color="cyan">{kind}</Text>
                </Text>
            </Box>
            <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
                {lines.length === 0 ? (
                    <Text color="gray">No messages.</Text>
                ) : (
                    lines.map((m, i) => (
                        <Text key={`${m}-${i}`} color={i === index ? 'cyan' : 'white'}>
                            {i === index ? '> ' : '  '}
                            {m}
                        </Text>
                    ))
                )}
            </Box>
        </Box>
    );
}
