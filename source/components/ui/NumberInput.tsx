import React from 'react';
import { Text } from 'ink';
import TextInput from 'ink-text-input';
import { Row } from './Row.js';

export interface NumberInputProps {
    label: string;
    value: number | string;
    focused: boolean;
    onChange: (v: string) => void;
    onSubmit: (v: string) => void;
}

export function NumberInput({ label, value, focused, onChange, onSubmit }: NumberInputProps) {
    return (
        <Row label={label} focused={focused}>
            {focused ? (
                <TextInput
                    value={String(value)}
                    onChange={onChange}
                    onSubmit={onSubmit}
                />
            ) : (
                <Text>{value}</Text>
            )}
        </Row>
    );
}
