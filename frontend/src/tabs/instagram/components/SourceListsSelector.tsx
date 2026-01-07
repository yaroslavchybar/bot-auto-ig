import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ListRow, InstagramSettings } from '../types';
import { RefreshCw } from 'lucide-react';
import { apiFetch } from '@/lib/api';

interface SourceListsSelectorProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    settings: InstagramSettings;
    onUpdate: (next: InstagramSettings | ((prev: InstagramSettings) => InstagramSettings)) => void;
}

export function SourceListsSelector({ open, onOpenChange, settings, onUpdate }: SourceListsSelectorProps) {
    const [lists, setLists] = useState<ListRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchLists = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await apiFetch<Array<{ id?: unknown; _id?: unknown; name?: unknown }>>('/api/lists');
            const fetchedLists = (Array.isArray(data) ? data : [])
                .map((l) => {
                    const id = String(l.id ?? l._id ?? '').trim();
                    const name = String(l.name ?? '').trim();
                    if (!id || !name) return null;
                    return { id, name } as ListRow;
                })
                .filter((v): v is ListRow => Boolean(v));
            setLists(fetchedLists);

            // Clean up orphaned list IDs (references to deleted lists)
            const validIds = new Set(fetchedLists.map((l: ListRow) => l.id));
            const currentIds = settings.source_list_ids;
            const orphanedIds = currentIds.filter(id => !validIds.has(id));
            if (orphanedIds.length > 0) {
                onUpdate(prev => ({
                    ...prev,
                    source_list_ids: prev.source_list_ids.filter(id => validIds.has(id))
                }));
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load lists');
        } finally {
            setLoading(false);
        }
    }, [onUpdate, settings.source_list_ids]);

    useEffect(() => {
        if (open) {
            fetchLists();
        }
    }, [open, fetchLists]);

    const toggleList = (listId: string) => {
        if (!listId) return;
        onUpdate(prev => {
            const set = new Set(prev.source_list_ids);
            if (set.has(listId)) {
                set.delete(listId);
            } else {
                set.add(listId);
            }
            return { ...prev, source_list_ids: [...set] };
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <div className="flex items-center justify-between">
                        <DialogTitle>Source Lists</DialogTitle>
                        <Button variant="ghost" size="icon" onClick={fetchLists} disabled={loading}>
                            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        </Button>
                    </div>
                    <DialogDescription>
                        Select lists to use as sources for automation
                    </DialogDescription>
                </DialogHeader>

                {error && (
                    <div className="text-sm text-destructive">{error}</div>
                )}

                <ScrollArea className="h-[300px] pr-4">
                    {lists.length === 0 ? (
                        <div className="text-sm text-muted-foreground text-center py-8">
                            {loading ? 'Loading...' : 'No lists found'}
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {lists.map((list, index) => {
                                const isChecked = settings.source_list_ids.includes(list.id);
                                return (
                                    <div
                                        key={list.id || `list-${index}`}
                                        className={`flex items-center space-x-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 ${isChecked ? 'bg-accent/30 border-primary' : ''}`}
                                        onClick={() => toggleList(list.id)}
                                    >
                                        <Checkbox
                                            checked={isChecked}
                                            onCheckedChange={() => { }}
                                            className="pointer-events-none"
                                        />
                                        <span className="text-sm font-medium pointer-events-none">{list.name}</span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </ScrollArea>

                <div className="flex justify-between items-center pt-2 border-t">
                    <span className="text-sm text-muted-foreground">
                        {settings.source_list_ids.length} selected
                    </span>
                    <Button onClick={() => onOpenChange(false)}>Done</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
