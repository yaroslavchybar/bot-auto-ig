import React from 'react';
import { Text } from 'ink';
import { Row } from './Row.js';

interface CheckboxProps {
    label: string;
    checked: boolean;
    focused: boolean;
    hint?: string;
}

export function Checkbox({ label, checked, focused, hint }: CheckboxProps) {
    return (
        <Row label={label} focused={focused}>
            <Text>
                [{checked ? 'x' : ' '}] {hint ? <Text color="gray">{hint}</Text> : null}
            </Text>
        </Row>
    );
}
