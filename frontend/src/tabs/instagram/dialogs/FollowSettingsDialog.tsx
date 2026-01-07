import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { InstagramSettings } from '../types';

interface FollowSettingsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    settings: InstagramSettings;
    onUpdate: (next: InstagramSettings | ((prev: InstagramSettings) => InstagramSettings)) => void;
}

export function FollowSettingsDialog({ open, onOpenChange, settings, onUpdate }: FollowSettingsDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Follow Settings</DialogTitle>
                </DialogHeader>

                <ScrollArea className="max-h-[60vh] pr-4">
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="highlights_min">Highlights Min</Label>
                                <Input
                                    id="highlights_min"
                                    type="number"
                                    min={0}
                                    value={settings.highlights_min}
                                    onChange={(e) => onUpdate(prev => ({
                                        ...prev,
                                        highlights_min: Math.max(0, parseInt(e.target.value) || 0)
                                    }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="highlights_max">Highlights Max</Label>
                                <Input
                                    id="highlights_max"
                                    type="number"
                                    min={0}
                                    value={settings.highlights_max}
                                    onChange={(e) => onUpdate(prev => ({
                                        ...prev,
                                        highlights_max: Math.max(0, parseInt(e.target.value) || 0)
                                    }))}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="likes_percentage">Likes (% of posts)</Label>
                            <div className="flex items-center gap-2">
                                <Input
                                    id="likes_percentage"
                                    type="range"
                                    min={0}
                                    max={100}
                                    value={settings.likes_percentage}
                                    onChange={(e) => onUpdate(prev => ({
                                        ...prev,
                                        likes_percentage: parseInt(e.target.value) || 0
                                    }))}
                                    className="flex-1"
                                />
                                <span className="w-12 text-right text-sm">{settings.likes_percentage}%</span>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="scroll_percentage">Scroll (% of posts)</Label>
                            <div className="flex items-center gap-2">
                                <Input
                                    id="scroll_percentage"
                                    type="range"
                                    min={0}
                                    max={100}
                                    value={settings.scroll_percentage}
                                    onChange={(e) => onUpdate(prev => ({
                                        ...prev,
                                        scroll_percentage: parseInt(e.target.value) || 0
                                    }))}
                                    className="flex-1"
                                />
                                <span className="w-12 text-right text-sm">{settings.scroll_percentage}%</span>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="following_limit">Target Following Limit</Label>
                            <Input
                                id="following_limit"
                                type="number"
                                min={0}
                                value={settings.following_limit}
                                onChange={(e) => onUpdate(prev => ({
                                    ...prev,
                                    following_limit: Math.max(0, parseInt(e.target.value) || 0)
                                }))}
                            />
                            <p className="text-xs text-muted-foreground">
                                Skip profiles following more than this amount
                            </p>
                        </div>

                        <div className="border-t pt-4">
                            <Label className="text-sm font-medium">Follow Count per Session</Label>
                            <div className="grid grid-cols-2 gap-4 mt-2">
                                <div className="space-y-2">
                                    <Label htmlFor="follow_min" className="text-xs text-muted-foreground">Min</Label>
                                    <Input
                                        id="follow_min"
                                        type="number"
                                        min={1}
                                        value={settings.follow_min_count}
                                        onChange={(e) => onUpdate(prev => ({
                                            ...prev,
                                            follow_min_count: Math.max(1, parseInt(e.target.value) || 1)
                                        }))}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="follow_max" className="text-xs text-muted-foreground">Max</Label>
                                    <Input
                                        id="follow_max"
                                        type="number"
                                        min={1}
                                        value={settings.follow_max_count}
                                        onChange={(e) => onUpdate(prev => ({
                                            ...prev,
                                            follow_max_count: Math.max(1, parseInt(e.target.value) || 1)
                                        }))}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </ScrollArea>

                <div className="flex justify-end pt-4 border-t">
                    <Button onClick={() => onOpenChange(false)}>Done</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
