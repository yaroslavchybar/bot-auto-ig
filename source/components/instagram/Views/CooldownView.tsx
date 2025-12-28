import React from 'react';
import { Box, Text } from 'ink';

interface Props {
    kind: 'profile_reopen' | 'messaging';
    options: number[];
    index: number;
}

export function CooldownView({ kind, options, index }: Props) {
    const title = kind === 'profile_reopen' ? 'Reopen cooldown' : 'Messaging cooldown';
    const unit = kind === 'profile_reopen' ? 'min' : 'h';
    return (
        <Box flexDirection="column" padding={1}>
            <Text bold>{title}</Text>
            <Text color="gray">[Up/Down] Select  [Enter] Set  [Esc] Back</Text>
            <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
                {options.map((v, i) => (
                    <Text key={`${kind}-${v}`} color={i === index ? 'cyan' : 'white'}>
                        {i === index ? '> ' : '  '}
                        {v} {unit}
                    </Text>
                ))}
            </Box>
        </Box>
    );
}
