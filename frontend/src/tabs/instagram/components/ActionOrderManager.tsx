import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import type { InstagramSettings, ActionName } from '../types';
import { ACTIONS } from '../types';

interface ActionOrderManagerProps {
    settings: InstagramSettings;
    onUpdate: (next: InstagramSettings | ((prev: InstagramSettings) => InstagramSettings)) => void;
}

export function ActionOrderManager({ settings, onUpdate }: ActionOrderManagerProps) {
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

    const enabledMap: Record<ActionName, boolean> = {
        'Feed Scroll': settings.enable_feed,
        'Reels Scroll': settings.enable_reels,
        'Watch Stories': settings.watch_stories,
        'Follow': settings.enable_follow,
        'Unfollow': settings.do_unfollow,
        'Approve Requests': settings.do_approve,
        'Send Messages': settings.do_message,
    };

    // Filter to only show enabled actions, but preserve duplicates
    const visibleOrder = settings.action_order.filter(a => enabledMap[a]);

    // Available actions - all enabled actions can be added (including duplicates)
    const availableToAdd = ACTIONS.filter(a => enabledMap[a]);

    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', index.toString());
    };

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (draggedIndex !== null && index !== draggedIndex) {
            setDragOverIndex(index);
        }
    };

    const handleDragLeave = () => {
        setDragOverIndex(null);
    };

    const handleDrop = (e: React.DragEvent, dropIndex: number) => {
        e.preventDefault();

        if (draggedIndex === null || draggedIndex === dropIndex) {
            setDraggedIndex(null);
            setDragOverIndex(null);
            return;
        }

        // Get indices in the full action_order array
        const visibleToFullIndex = (visibleIdx: number): number => {
            let count = 0;
            for (let i = 0; i < settings.action_order.length; i++) {
                if (enabledMap[settings.action_order[i]]) {
                    if (count === visibleIdx) return i;
                    count++;
                }
            }
            return -1;
        };

        const fromFullIndex = visibleToFullIndex(draggedIndex);
        const toFullIndex = visibleToFullIndex(dropIndex);

        if (fromFullIndex === -1 || toFullIndex === -1) {
            setDraggedIndex(null);
            setDragOverIndex(null);
            return;
        }

        onUpdate(prev => {
            const newOrder = [...prev.action_order];
            const [removed] = newOrder.splice(fromFullIndex, 1);
            const adjustedToIndex = toFullIndex > fromFullIndex ? toFullIndex - 1 : toFullIndex;

            // Find the correct insertion position 
            let insertIdx = adjustedToIndex;
            if (dropIndex > draggedIndex) {
                insertIdx = toFullIndex;
            }

            newOrder.splice(insertIdx, 0, removed);
            return { ...prev, action_order: newOrder };
        });

        setDraggedIndex(null);
        setDragOverIndex(null);
    };

    const handleDragEnd = () => {
        setDraggedIndex(null);
        setDragOverIndex(null);
    };

    const removeAction = (index: number) => {
        // Find the corresponding index in the full action_order
        let count = 0;
        for (let i = 0; i < settings.action_order.length; i++) {
            if (enabledMap[settings.action_order[i]]) {
                if (count === index) {
                    onUpdate(prev => ({
                        ...prev,
                        action_order: prev.action_order.filter((_, idx) => idx !== i)
                    }));
                    return;
                }
                count++;
            }
        }
    };

    const addAction = (action: ActionName) => {
        onUpdate(prev => ({
            ...prev,
            action_order: [...prev.action_order, action]
        }));
    };

    return (
        <Card>
            <CardHeader className="p-3 pb-1">
                <CardTitle className="text-sm font-medium">Action Order</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
                {visibleOrder.length === 0 ? (
                    <div className="text-sm text-muted-foreground text-center py-4">
                        Enable activities to configure order
                    </div>
                ) : (
                    <div className="space-y-1">
                        {visibleOrder.map((action, index) => (
                            <div
                                key={`${action}-${index}`}
                                draggable
                                onDragStart={(e) => handleDragStart(e, index)}
                                onDragOver={(e) => handleDragOver(e, index)}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, index)}
                                onDragEnd={handleDragEnd}
                                className={`
                                    flex items-center justify-between p-2 rounded-lg border bg-card
                                    cursor-grab active:cursor-grabbing transition-all duration-150
                                    ${draggedIndex === index ? 'opacity-50 scale-95' : ''}
                                    ${dragOverIndex === index ? 'border-primary border-2 bg-primary/5' : ''}
                                    hover:border-muted-foreground/50
                                `}
                            >
                                <div className="flex items-center gap-2">
                                    <GripVertical className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-sm">{index + 1}. {action}</span>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-destructive hover:text-destructive"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        removeAction(index);
                                    }}
                                >
                                    <Trash2 className="h-3 w-3" />
                                </Button>
                            </div>
                        ))}
                    </div>
                )}

                {availableToAdd.length > 0 && (
                    <div className="mt-3 pt-3 border-t">
                        <div className="text-xs text-muted-foreground mb-2">Add activity (can add multiple):</div>
                        <div className="flex flex-wrap gap-1">
                            {availableToAdd.map(action => (
                                <Button
                                    key={action}
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() => addAction(action)}
                                >
                                    <Plus className="h-3 w-3 mr-1" />
                                    {action}
                                </Button>
                            ))}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
