import React, { useEffect } from 'react';
import { useInput } from 'ink';
import { useLists } from './hooks/useLists.js';
import { ListView } from './Views/ListView.js';
import { CreateView } from './Views/CreateView.js';
import { EditView } from './Views/EditView.js';
import { DeleteView } from './Views/DeleteView.js';

type Props = {
    onBack: () => void;
    initialSelectedIndex: number;
    onSelectedIndexChange: (index: number) => void;
};

export default function Lists({ onBack, initialSelectedIndex, onSelectedIndexChange }: Props) {
    const {
        // State
        lists,
        loading,
        error,
        mode,
        selectedIndex,
        inputName,
        selectedList,
        editFocus,
        profiles,
        profilesIndex,

        // Setters
        setInputName,
        setEditFocus,
        setProfilesIndex,

        // Actions
        fetchLists,
        handleCreate,
        handleDelete,
        enterEdit,
        toggleProfile,
        saveEditChanges,
        startCreate,
        startDelete,
        cancelMode,
        moveSelection,
    } = useLists(onSelectedIndexChange, initialSelectedIndex);

    useEffect(() => {
        fetchLists();
    }, [fetchLists]);

    useInput((input, key) => {
        if (loading) return;

        if (mode === 'list') {
            if (key.escape) {
                onBack();
            } else if (key.upArrow) {
                moveSelection(-1);
            } else if (key.downArrow) {
                moveSelection(1);
            } else if (input === 'n' || input === 'N') {
                startCreate();
            } else if (input === 'e' || input === 'E') {
                if (lists[selectedIndex]) {
                    void enterEdit(lists[selectedIndex]);
                }
            } else if ((key.delete || key.backspace || input === 'd' || input === 'D') && lists[selectedIndex]) {
                startDelete(lists[selectedIndex]);
            }
        } else if (mode === 'create') {
            if (key.escape) {
                cancelMode();
            } else if (key.return) {
                handleCreate();
            }
        } else if (mode === 'edit') {
            if (key.escape) {
                cancelMode();
            } else if (input === 'n' || input === 'N') {
                setEditFocus('name');
            } else if (input === 'p' || input === 'P') {
                setEditFocus('profiles');
            } else if ((key.return || input === ' ') && editFocus === 'profiles') {
                toggleProfile(profilesIndex);
            } else if (key.upArrow && editFocus === 'profiles') {
                setProfilesIndex(i => Math.max(0, Math.min(profiles.length - 1, i - 1)));
            } else if (key.downArrow && editFocus === 'profiles') {
                setProfilesIndex(i => Math.max(0, Math.min(profiles.length - 1, i + 1)));
            } else if (input === 's' || input === 'S') {
                void saveEditChanges();
            } else if (key.return && editFocus === 'name') {
                setEditFocus('profiles');
            }
        } else if (mode === 'delete') {
            if (key.escape || input === 'n' || input === 'N') {
                cancelMode();
            } else if (input === 'y' || input === 'Y' || key.return) {
                handleDelete();
            }
        }
    });

    if (mode === 'create') {
        return (
            <CreateView
                inputName={inputName}
                onInputChange={setInputName}
                onSubmit={handleCreate}
            />
        );
    }

    if (mode === 'edit') {
        return (
            <EditView
                inputName={inputName}
                onInputChange={setInputName}
                editFocus={editFocus}
                onEditFocusChange={setEditFocus}
                profiles={profiles}
                profilesIndex={profilesIndex}
                loading={loading}
                error={error}
            />
        );
    }

    if (mode === 'delete') {
        return <DeleteView listName={selectedList?.name} />;
    }

    return (
        <ListView
            lists={lists}
            selectedIndex={selectedIndex}
            loading={loading}
            error={error}
        />
    );
}
