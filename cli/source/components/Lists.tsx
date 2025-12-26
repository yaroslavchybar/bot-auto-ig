import React, {useState, useEffect, useMemo} from 'react';
import {Text, Box, useInput} from 'ink';
import TextInput from 'ink-text-input';
import {callBridge} from '../lib/supabase.js';

type List = {
	id: string;
	name: string;
};

type Mode = 'list' | 'create' | 'edit' | 'delete';
type EditFocus = 'profiles' | 'name';
type ProfileRow = {profile_id: string; name: string; selected: boolean; initialSelected: boolean};

export default function Lists({onBack}: {onBack: () => void}) {
	const [lists, setLists] = useState<List[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
    const [mode, setMode] = useState<Mode>('list');
    const [selectedIndex, setSelectedIndex] = useState(0);
    
    // For Create/Edit
    const [inputName, setInputName] = useState('');
    const [selectedList, setSelectedList] = useState<List | null>(null);
    const [editFocus, setEditFocus] = useState<EditFocus>('profiles');
    const [profiles, setProfiles] = useState<ProfileRow[]>([]);
    const [profilesIndex, setProfilesIndex] = useState(0);

	useEffect(() => {
		fetchLists();
	}, []);

	const fetchLists = async () => {
		setLoading(true);
		setError(null);
		try {
			const data = await callBridge<List[]>('lists.list');
			setLists(data || []);
			setSelectedIndex(0);
		} catch (e: any) {
			setError(e?.message || String(e));
			setLists([]);
		}
		setLoading(false);
	};

    const handleCreate = async () => {
        if (!inputName.trim()) return;
        setLoading(true);
		setError(null);
		try {
			await callBridge('lists.create', {name: inputName});
            setInputName('');
            setMode('list');
            fetchLists();
		} catch (e: any) {
			setError(e?.message || String(e));
		}
        setLoading(false);
    };

    const handleUpdate = async () => {
        if (!selectedList || !inputName.trim()) return;
        setLoading(true);
		setError(null);
		try {
			await callBridge('lists.update', {id: selectedList.id, name: inputName});
            setInputName('');
            setMode('list');
            fetchLists();
		} catch (e: any) {
			setError(e?.message || String(e));
		}
        setLoading(false);
    };

    const handleDelete = async () => {
        if (!selectedList) return;
        setLoading(true);
		setError(null);
		try {
			await callBridge('lists.delete', {id: selectedList.id});
            setMode('list');
            fetchLists();
		} catch (e: any) {
			setError(e?.message || String(e));
		}
        setLoading(false);
    };
    
    const fetchProfilesForEdit = async (listId: string) => {
        setLoading(true);
        setError(null);
        let assigned: any[] = [];
        let unassigned: any[] = [];
		try {
			assigned = (await callBridge<any[]>('profiles.list_assigned', {list_id: listId})) || [];
		} catch {
			assigned = [];
		}
		try {
			unassigned = (await callBridge<any[]>('profiles.list_unassigned')) || [];
		} catch {
			unassigned = [];
		}
        const rows: ProfileRow[] = [];
        for (const r of assigned) {
            rows.push({profile_id: String(r.profile_id), name: String(r.name || ''), selected: true, initialSelected: true});
        }
        for (const r of unassigned) {
            rows.push({profile_id: String(r.profile_id), name: String(r.name || ''), selected: false, initialSelected: false});
        }
        setProfiles(rows);
        setProfilesIndex(0);
        setLoading(false);
    };
    
    const enterEdit = async (list: List) => {
        setSelectedList(list);
        setInputName(list.name);
        setMode('edit');
        setEditFocus('profiles');
        await fetchProfilesForEdit(list.id);
    };
    
    const toggleProfile = (i: number) => {
        const row = profiles[i];
        if (!row) return;
        const next = [...profiles];
        next[i] = {...row, selected: !row.selected};
        setProfiles(next);
    };
    
    const saveEditChanges = async () => {
        if (!selectedList) return;
        setLoading(true);
        setError(null);
        const toAdd = profiles.filter(p => p.selected && !p.initialSelected).map(p => p.profile_id);
        const toRemove = profiles.filter(p => !p.selected && p.initialSelected).map(p => p.profile_id);
		try {
			if (inputName.trim() && inputName.trim() !== selectedList.name) {
				await callBridge('lists.update', {id: selectedList.id, name: inputName.trim()});
			}
			if (toAdd.length > 0) {
				await callBridge('profiles.bulk_set_list_id', {profile_ids: toAdd, list_id: selectedList.id});
			}
			if (toRemove.length > 0) {
				await callBridge('profiles.bulk_set_list_id', {profile_ids: toRemove, list_id: null});
			}
		} catch (e: any) {
			setError(e?.message || String(e));
		}
        setMode('list');
        await fetchLists();
        setLoading(false);
    };

	useInput((input, key) => {
        if (loading) return;

        if (mode === 'list') {
            if (key.escape) {
                onBack();
            } else if (key.upArrow) {
                setSelectedIndex(prev => Math.max(0, prev - 1));
            } else if (key.downArrow) {
                setSelectedIndex(prev => Math.min(lists.length - 1, prev + 1));
            } else if (input === 'n' || input === 'N') { // New
                setMode('create');
                setInputName('');
            } else if (input === 'e' || input === 'E') { // Edit
                if (lists[selectedIndex]) {
                    void enterEdit(lists[selectedIndex]);
                }
            } else if ((key.delete || key.backspace || input === 'd' || input === 'D') && lists[selectedIndex]) { // Delete
                 setSelectedList(lists[selectedIndex]);
                 setMode('delete');
            }
        } else if (mode === 'create') {
            if (key.escape) {
                setMode('list');
            } else if (key.return) {
                handleCreate();
            }
        } else if (mode === 'edit') {
            if (key.escape) {
                setMode('list');
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
                setMode('list');
            } else if (input === 'y' || input === 'Y' || key.return) {
                handleDelete();
            }
        }
	});

    const editHelp = useMemo(() => {
        return editFocus === 'profiles'
            ? '[Up/Down] Navigate  [Space/Enter] Toggle  [N] Edit name  [S] Save  [Esc] Back'
            : '[Enter] Apply name  [P] Profiles  [S] Save  [Esc] Back';
    }, [editFocus]);

    if (mode === 'create') {
        return (
            <Box flexDirection="column" padding={1}>
                <Text bold>Create New List</Text>
                <Box marginTop={1}>
                    <Text>Name: </Text>
                    <TextInput value={inputName} onChange={setInputName} onSubmit={handleCreate} />
                </Box>
                <Box marginTop={1}>
                    <Text color="gray">[Enter] Save  [Esc] Cancel</Text>
                </Box>
            </Box>
        );
    }

    if (mode === 'edit') {
        return (
             <Box flexDirection="column" padding={1}>
                <Text bold>Edit List</Text>
                <Text color="gray">{editHelp}</Text>
                <Box marginTop={1}>
                    <Text>Name: </Text>
                    {editFocus === 'name' ? (
                        <TextInput value={inputName} onChange={setInputName} onSubmit={() => setEditFocus('profiles')} />
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

    if (mode === 'delete') {
         return (
            <Box flexDirection="column" padding={1} borderColor="red" borderStyle="single">
              <Text bold color="red">Delete List</Text>
              <Box marginTop={1}>
                <Text>Are you sure you want to delete list </Text>
                <Text bold color="yellow">{selectedList?.name}</Text>
                <Text>?</Text>
              </Box>
              <Box marginTop={1}>
                <Text color="gray">[Y]es / [N]o / [Esc] Cancel</Text>
              </Box>
            </Box>
          );
    }

	return (
		<Box flexDirection="column" padding={1}>
			<Text bold>Lists Manager</Text>
			<Text color="gray">[N] New List  [E] Edit  [D] Delete  [Esc] Back</Text>
			
			<Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
				{loading ? (
					<Text>Loading...</Text>
				) : error ? (
					<Text color="red">Error: {error}</Text>
				) : lists.length === 0 ? (
					<Text>No lists found.</Text>
				) : (
					lists.map((list, index) => (
						<Box key={list.id}>
                            <Text color={index === selectedIndex ? 'cyan' : 'white'}>
                                {index === selectedIndex ? '> ' : '  '} {list.name}
                            </Text>
                        </Box>
					))
				)}
			</Box>
		</Box>
	);
}
