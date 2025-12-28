import React, { useMemo } from 'react';
import { Text, Box } from 'ink';
import TextInput from 'ink-text-input';
import { ProfileRow, EditFocus } from '../hooks/useLists.js';

interface Props {
    inputName: string;
    onInputChange: (value: string) => void;
    editFocus: EditFocus;
    onEditFocusChange: (focus: EditFocus) => void;
    profiles: ProfileRow[];
    profilesIndex: number;
    loading: boolean;
    error: string | null;
}

export function EditView({
    inputName,
    onInputChange,
    editFocus,
    onEditFocusChange,
    profiles,
    profilesIndex,
    loading,
    error,
}: Props) {
    const editHelp = useMemo(() => {
        return editFocus === 'profiles'
            ? '[Up/Down] Navigate  [Space/Enter] Toggle  [N] Edit name  [S] Save  [Esc] Back'
            : '[Enter] Apply name  [P] Profiles  [S] Save  [Esc] Back';
    }, [editFocus]);

    return (
        <Box flexDirection="column" padding={1}>
            <Text bold>Edit List</Text>
            <Text color="gray">{editHelp}</Text>
            <Box marginTop={1}>
                <Text>Name: </Text>
                {editFocus === 'name' ? (
                    <TextInput
                        value={inputName}
                        onChange={onInputChange}
                        onSubmit={() => onEditFocusChange('profiles')}
                    />
                ) : (
                    <Text>{inputName}</Text>
                )}
            </Box>
            <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
                {loading ? (
                    <Text>Loading...</Text>
                ) : profiles.length === 0 ? (
                    <Text color="gray">No profiles.</Text>
                ) : (
                    profiles.map((p, i) => (
                        <Text key={p.profile_id} color={editFocus === 'profiles' && i === profilesIndex ? 'cyan' : 'white'}>
                            {editFocus === 'profiles' && i === profilesIndex ? '> ' : '  '}[{p.selected ? 'x' : ' '}] {p.name}
                        </Text>
                    ))
                )}
            </Box>
            {error ? (
                <Box marginTop={1}>
                    <Text color="red">{error}</Text>
                </Box>
            ) : null}
        </Box>
    );
}
