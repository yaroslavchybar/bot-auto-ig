import { useState, useCallback, useRef, useEffect } from 'react';
import {
    listsList,
    listsCreate,
    listsUpdate,
    listsDelete,
    profilesListAssigned,
    profilesListUnassigned,
    profilesBulkSetListId,
} from '../../../lib/supabase.js';

export type List = {
    id: string;
    name: string;
};

export type Mode = 'list' | 'create' | 'edit' | 'delete';
export type EditFocus = 'profiles' | 'name';
export type ProfileRow = {
    profile_id: string;
    name: string;
    selected: boolean;
    initialSelected: boolean;
};

function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
}

export function useLists(onSelectedIndexChange?: (index: number) => void, initialSelectedIndex = 0) {
    const [lists, setLists] = useState<List[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [mode, setMode] = useState<Mode>('list');
    const [selectedIndex, setSelectedIndex] = useState(initialSelectedIndex);
    const onSelectedIndexChangeRef = useRef(onSelectedIndexChange);

    // For Create/Edit
    const [inputName, setInputName] = useState('');
    const [selectedList, setSelectedList] = useState<List | null>(null);
    const [editFocus, setEditFocus] = useState<EditFocus>('profiles');
    const [profiles, setProfiles] = useState<ProfileRow[]>([]);
    const [profilesIndex, setProfilesIndex] = useState(0);

    useEffect(() => {
        onSelectedIndexChangeRef.current = onSelectedIndexChange;
    }, [onSelectedIndexChange]);

    useEffect(() => {
        onSelectedIndexChangeRef.current?.(selectedIndex);
    }, [selectedIndex]);

    const fetchLists = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await listsList();
            const nextLists = data || [];
            setLists(nextLists);
            setSelectedIndex(prev => clamp(prev, 0, Math.max(0, nextLists.length - 1)));
        } catch (e: any) {
            setError(e?.message || String(e));
            setLists([]);
            setSelectedIndex(0);
        }
        setLoading(false);
    }, []);

    const handleCreate = useCallback(async () => {
        if (!inputName.trim()) return;
        setLoading(true);
        setError(null);
        try {
            await listsCreate(inputName);
            setInputName('');
            setMode('list');
            await fetchLists();
        } catch (e: any) {
            setError(e?.message || String(e));
        }
        setLoading(false);
    }, [inputName, fetchLists]);

    const handleUpdate = useCallback(async () => {
        if (!selectedList || !inputName.trim()) return;
        setLoading(true);
        setError(null);
        try {
            await listsUpdate(selectedList.id, inputName);
            setInputName('');
            setMode('list');
            await fetchLists();
        } catch (e: any) {
            setError(e?.message || String(e));
        }
        setLoading(false);
    }, [selectedList, inputName, fetchLists]);

    const handleDelete = useCallback(async () => {
        if (!selectedList) return;
        setLoading(true);
        setError(null);
        try {
            await listsDelete(selectedList.id);
            setMode('list');
            await fetchLists();
        } catch (e: any) {
            setError(e?.message || String(e));
        }
        setLoading(false);
    }, [selectedList, fetchLists]);

    const fetchProfilesForEdit = useCallback(async (listId: string) => {
        setLoading(true);
        setError(null);
        let assigned: any[] = [];
        let unassigned: any[] = [];
        const [assignedRes, unassignedRes] = await Promise.allSettled([
            profilesListAssigned(listId),
            profilesListUnassigned(),
        ]);
        assigned = assignedRes.status === 'fulfilled' ? (assignedRes.value || []) : [];
        unassigned = unassignedRes.status === 'fulfilled' ? (unassignedRes.value || []) : [];
        const rows: ProfileRow[] = [];
        for (const r of assigned) {
            rows.push({ profile_id: String(r.profile_id), name: String(r.name || ''), selected: true, initialSelected: true });
        }
        for (const r of unassigned) {
            rows.push({ profile_id: String(r.profile_id), name: String(r.name || ''), selected: false, initialSelected: false });
        }
        setProfiles(rows);
        setProfilesIndex(0);
        setLoading(false);
    }, []);

    const enterEdit = useCallback(async (list: List) => {
        setSelectedList(list);
        setInputName(list.name);
        setMode('edit');
        setEditFocus('profiles');
        await fetchProfilesForEdit(list.id);
    }, [fetchProfilesForEdit]);

    const toggleProfile = useCallback((i: number) => {
        setProfiles(prev => {
            const row = prev[i];
            if (!row) return prev;
            const next = [...prev];
            next[i] = { ...row, selected: !row.selected };
            return next;
        });
    }, []);

    const saveEditChanges = useCallback(async () => {
        if (!selectedList) return;
        setLoading(true);
        setError(null);
        const toAdd = profiles.filter(p => p.selected && !p.initialSelected).map(p => p.profile_id);
        const toRemove = profiles.filter(p => !p.selected && p.initialSelected).map(p => p.profile_id);
        try {
            if (inputName.trim() && inputName.trim() !== selectedList.name) {
                await listsUpdate(selectedList.id, inputName.trim());
            }
            if (toAdd.length > 0) {
                await profilesBulkSetListId(toAdd, selectedList.id);
            }
            if (toRemove.length > 0) {
                await profilesBulkSetListId(toRemove, null);
            }
        } catch (e: any) {
            setError(e?.message || String(e));
        }
        setMode('list');
        await fetchLists();
        setLoading(false);
    }, [selectedList, inputName, profiles, fetchLists]);

    const startCreate = useCallback(() => {
        setMode('create');
        setInputName('');
    }, []);

    const startDelete = useCallback((list: List) => {
        setSelectedList(list);
        setMode('delete');
    }, []);

    const cancelMode = useCallback(() => {
        setMode('list');
    }, []);

    const moveSelection = useCallback((delta: number) => {
        setSelectedIndex(prev => clamp(prev + delta, 0, Math.max(0, lists.length - 1)));
    }, [lists.length]);

    return {
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
        setError,

        // Actions
        fetchLists,
        handleCreate,
        handleUpdate,
        handleDelete,
        enterEdit,
        toggleProfile,
        saveEditChanges,
        startCreate,
        startDelete,
        cancelMode,
        moveSelection,
    };
}
