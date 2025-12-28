import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { Profile } from '../../../lib/profiles.js';
import { clamp } from '../../../lib/utils.js';

interface Props {
    mode: 'create' | 'edit';
    formData: Partial<Profile>;
    activeField: number;
    isEditingSelect: boolean;
    selectIndexByKey: Record<string, number>;
    error: string | null;
    fields: any[];
    onSetFormData: (data: any) => void;
    onSetIsEditingSelect: (val: boolean) => void;
    onSetSelectIndexByKey: (updater: (prev: any) => any) => void;
}

export function FormView({
    mode,
    formData,
    activeField,
    isEditingSelect,
    selectIndexByKey,
    error,
    fields,
    onSetFormData,
    onSetIsEditingSelect,
    onSetSelectIndexByKey
}: Props) {
    return (
        <Box flexDirection="column" padding={1}>
            <Text bold>{mode === 'create' ? 'Create New Profile' : 'Edit Profile'}</Text>
            {error && <Text color="red">{error}</Text>}

            <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" padding={1}>
                {fields.map((field, index) => {
                    const isActive = index === activeField;
                    const labelColor = isActive ? 'green' : 'white';
                    const prefix = isActive ? '> ' : '  ';

                    // Section Headers
                    let sectionHeader = null;
                    if (field.key === 'name') sectionHeader = <Text color="blue" bold underline>Basic Info</Text>;
                    if (field.key === 'connection') sectionHeader = <Box marginTop={1}><Text color="blue" bold underline>Network Settings</Text></Box>;
                    if (field.key === 'ua_os') sectionHeader = <Box marginTop={1}><Text color="blue" bold underline>Fingerprint</Text></Box>;
                    if (field.key === 'save') sectionHeader = <Box marginTop={1} borderStyle="single" borderLeft={false} borderRight={false} borderTop={false} borderColor="gray" marginBottom={1}></Box>;

                    if (field.type === 'button') {
                        return (
                            <Box key={field.key} flexDirection="column">
                                {sectionHeader}
                                <Box marginTop={field.key === 'save' || field.key === 'cancel' ? 0 : 1}>
                                    <Text color={isActive ? 'black' : 'white'} backgroundColor={isActive ? 'green' : undefined}>
                                        {' ' + field.label + ' '}
                                    </Text>
                                </Box>
                            </Box>
                        );
                    }

                    let content;
                    if (field.type === 'text') {
                        if (isActive) {
                            content = (
                                <TextInput
                                    value={(formData as any)[field.key] || ''}
                                    onChange={(val) => onSetFormData({ ...formData, [field.key]: val })}
                                />
                            );
                        } else {
                            content = <Text color="gray" wrap="truncate-end">{(formData as any)[field.key] || ''}</Text>;
                        }
                    } else if (field.type === 'select') {
                        const currentValue = (formData as any)[field.key];
                        const options = field.options as any[];
                        const currentOption = options.find(o => o.value === currentValue);
                        const displayValue = currentOption ? currentOption.label : currentValue;

                        if (isActive && isEditingSelect) {
                            const selectedIdx = options.findIndex(o => o.value === currentValue);
                            const lastIdx = selectIndexByKey[field.key] ?? (selectedIdx >= 0 ? selectedIdx : 0);
                            const initialIndex = clamp(lastIdx, 0, Math.max(0, options.length - 1));

                            content = (
                                <Box borderStyle="round" borderColor="blue">
                                    <SelectInput
                                        items={options as any}
                                        initialIndex={initialIndex}
                                        onHighlight={item => {
                                            const idx = options.findIndex(o => o.value === item.value);
                                            if (idx >= 0) onSetSelectIndexByKey((prev: any) => ({ ...prev, [field.key]: idx }));
                                        }}
                                        onSelect={(item) => {
                                            const updates: any = { [field.key]: item.value };
                                            // Delegate logic to parent if needed, but for now we do it here
                                            if (field.key === 'connection' && item.value === 'direct') updates.proxy = '';

                                            onSetFormData({ ...formData, ...updates });
                                            onSetIsEditingSelect(false);
                                        }}
                                    />
                                </Box>
                            );
                        } else {
                            content = <Text color={isActive ? 'cyan' : 'gray'}>{displayValue}</Text>;
                        }
                    } else if (field.type === 'toggle') {
                        const val = (formData as any)[field.key];
                        content = <Text color={val ? 'cyan' : 'gray'}>{val ? 'Yes' : 'No'}</Text>;
                    }

                    return (
                        <Box key={field.key} flexDirection="column" marginBottom={0}>
                            {sectionHeader}
                            <Box flexDirection="row">
                                <Box width={30}>
                                    <Text color={labelColor}>{prefix}{field.label}: </Text>
                                </Box>
                                <Box flexGrow={1}>
                                    {content}
                                </Box>
                            </Box>
                        </Box>
                    );
                })}
            </Box>

            <Box marginTop={1}>
                <Text color="gray">↑/↓: Navigate | Enter: Edit/Toggle | Esc: Cancel</Text>
            </Box>
        </Box>
    );
}
