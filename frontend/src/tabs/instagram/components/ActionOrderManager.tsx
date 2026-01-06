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
    const enabledMap: Record<ActionName, boolean> = {
        'Feed Scroll': settings.enable_feed,
        'Reels Scroll': settings.enable_reels,
        'Watch Stories': settings.watch_stories,
        'Follow': settings.enable_follow,
        'Unfollow': settings.do_unfollow,
        'Approve Requests': settings.do_approve,
        'Send Messages': settings.do_message,
    };

    const visibleOrder = settings.action_order.filter(a => enabledMap[a]);
    const availableToAdd = ACTIONS.filter(a => enabledMap[a] && !settings.action_order.includes(a));

    const moveAction = (index: number, direction: -1 | 1) => {
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= visibleOrder.length) return;

        // Find positions in full action_order
        const action = visibleOrder[index];
        const swapAction = visibleOrder[newIndex];

        onUpdate(prev => {
            const newOrder = [...prev.action_order];
            const actionIdx = newOrder.indexOf(action);
            const swapIdx = newOrder.indexOf(swapAction);

            [newOrder[actionIdx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[actionIdx]];

            return { ...prev, action_order: newOrder };
        });
    };

    const removeAction = (action: ActionName) => {
        onUpdate(prev => ({
            ...prev,
            action_order: prev.action_order.filter(a => a !== action)
        }));
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
                    <div className="space-y-2">
                        {visibleOrder.map((action, index) => (
                            <div
                                key={action}
                                className="flex items-center justify-between p-2 rounded-lg border bg-card"
                            >
                                <div className="flex items-center gap-2">
                                    <GripVertical className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-sm">{index + 1}. {action}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        disabled={index === 0}
                                        onClick={() => moveAction(index, -1)}
                                    >
                                        ↑
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        disabled={index === visibleOrder.length - 1}
                                        onClick={() => moveAction(index, 1)}
                                    >
                                        ↓
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-destructive"
                                        onClick={() => removeAction(action)}
                                    >
                                        <Trash2 className="h-3 w-3" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {availableToAdd.length > 0 && (
                    <div className="mt-3 pt-3 border-t">
                        <div className="text-xs text-muted-foreground mb-2">Add to order:</div>
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
