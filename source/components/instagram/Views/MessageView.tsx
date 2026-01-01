import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

function parseTemplate(raw: string): { messages: string[] } {
    const parts = raw.split('|');
    if (parts.length <= 1) return { messages: [raw] };
    const first = parts[0] ?? '';
    const second = parts.slice(1).join('|');
    if (!second.trim()) return { messages: [raw] };
    return { messages: [first, second] };
}

function renderCompact(raw: string) {
    return raw.split('\\').join(' ⏎ ').split('|').join(' │ ');
}

function renderPreviewText(raw: string) {
    return raw.split('\\').join('\n');
}

function indentLines(text: string, indent: string) {
    const lines = String(text || '').split('\n');
    return lines.map(l => `${indent}${l}`).join('\n');
}

function TemplatePreview({ text }: { text: string }) {
    if (!String(text || '').trim()) return null;
    const parsed = parseTemplate(text);
    return (
        <Box flexDirection="column">
            <Box flexDirection="column">
                {parsed.messages.map((m, i) => (
                    <Box key={i} flexDirection="column">
                        {parsed.messages.length > 1 ? <Text color="gray">{i + 1}:</Text> : null}
                        <Text>{indentLines(renderPreviewText(m), parsed.messages.length > 1 ? '  ' : '')}</Text>
                        {i !== parsed.messages.length - 1 ? <Text color="gray">---</Text> : null}
                    </Box>
                ))}
            </Box>
        </Box>
    );
}

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
                    <Text color="gray">Text: </Text>
                    <TextInput value={draft} onChange={onDraftChange} onSubmit={onSubmitDraft} focus />
                </Box>

                <Box marginTop={1} flexDirection="column">
                    <TemplatePreview text={draft} />
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
                            {renderCompact(m)}
                        </Text>
                    ))
                )}
            </Box>

            <Box marginTop={1} flexDirection="column">
                <TemplatePreview text={lines[index] || ''} />
            </Box>
        </Box>
    );
}
