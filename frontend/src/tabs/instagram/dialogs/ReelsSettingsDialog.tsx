import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { InstagramSettings } from '../types';

interface ReelsSettingsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    settings: InstagramSettings;
    onUpdate: (next: InstagramSettings | ((prev: InstagramSettings) => InstagramSettings)) => void;
}

export function ReelsSettingsDialog({ open, onOpenChange, settings, onUpdate }: ReelsSettingsDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Reels Settings</DialogTitle>
                </DialogHeader>

                <ScrollArea className="max-h-[60vh] pr-4">
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="reels_min_time">Min Time (min)</Label>
                                <Input
                                    id="reels_min_time"
                                    type="number"
                                    min={1}
                                    value={settings.reels_min_time_minutes}
                                    onChange={(e) => onUpdate(prev => ({
                                        ...prev,
                                        reels_min_time_minutes: Math.max(1, parseInt(e.target.value) || 1)
                                    }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="reels_max_time">Max Time (min)</Label>
                                <Input
                                    id="reels_max_time"
                                    type="number"
                                    min={1}
                                    value={settings.reels_max_time_minutes}
                                    onChange={(e) => onUpdate(prev => ({
                                        ...prev,
                                        reels_max_time_minutes: Math.max(1, parseInt(e.target.value) || 1)
                                    }))}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Like Chance (%)</Label>
                            <div className="flex items-center gap-2">
                                <Input
                                    type="range"
                                    min={0}
                                    max={100}
                                    value={settings.reels_like_chance}
                                    onChange={(e) => onUpdate(prev => ({
                                        ...prev,
                                        reels_like_chance: parseInt(e.target.value) || 0
                                    }))}
                                    className="flex-1"
                                />
                                <span className="w-12 text-right text-sm">{settings.reels_like_chance}%</span>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Follow Chance (%)</Label>
                            <div className="flex items-center gap-2">
                                <Input
                                    type="range"
                                    min={0}
                                    max={100}
                                    value={settings.reels_follow_chance}
                                    onChange={(e) => onUpdate(prev => ({
                                        ...prev,
                                        reels_follow_chance: parseInt(e.target.value) || 0
                                    }))}
                                    className="flex-1"
                                />
                                <span className="w-12 text-right text-sm">{settings.reels_follow_chance}%</span>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Skip Chance (%)</Label>
                            <div className="flex items-center gap-2">
                                <Input
                                    type="range"
                                    min={0}
                                    max={100}
                                    value={settings.reels_skip_chance}
                                    onChange={(e) => onUpdate(prev => ({
                                        ...prev,
                                        reels_skip_chance: parseInt(e.target.value) || 0
                                    }))}
                                    className="flex-1"
                                />
                                <span className="w-12 text-right text-sm">{settings.reels_skip_chance}%</span>
                            </div>
                        </div>

                        <div className="border-t pt-4">
                            <Label className="text-sm font-medium">Skip Timing (seconds)</Label>
                            <div className="grid grid-cols-2 gap-4 mt-2">
                                <div className="space-y-2">
                                    <Label htmlFor="reels_skip_min" className="text-xs text-muted-foreground">Min</Label>
                                    <Input
                                        id="reels_skip_min"
                                        type="number"
                                        step={0.1}
                                        min={0}
                                        value={settings.reels_skip_min_time}
                                        onChange={(e) => onUpdate(prev => ({
                                            ...prev,
                                            reels_skip_min_time: Math.max(0, parseFloat(e.target.value) || 0)
                                        }))}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="reels_skip_max" className="text-xs text-muted-foreground">Max</Label>
                                    <Input
                                        id="reels_skip_max"
                                        type="number"
                                        step={0.1}
                                        min={0}
                                        value={settings.reels_skip_max_time}
                                        onChange={(e) => onUpdate(prev => ({
                                            ...prev,
                                            reels_skip_max_time: Math.max(0, parseFloat(e.target.value) || 0)
                                        }))}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="border-t pt-4">
                            <Label className="text-sm font-medium">Normal Watch Timing (seconds)</Label>
                            <div className="grid grid-cols-2 gap-4 mt-2">
                                <div className="space-y-2">
                                    <Label htmlFor="reels_normal_min" className="text-xs text-muted-foreground">Min</Label>
                                    <Input
                                        id="reels_normal_min"
                                        type="number"
                                        step={0.1}
                                        min={0}
                                        value={settings.reels_normal_min_time}
                                        onChange={(e) => onUpdate(prev => ({
                                            ...prev,
                                            reels_normal_min_time: Math.max(0, parseFloat(e.target.value) || 0)
                                        }))}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="reels_normal_max" className="text-xs text-muted-foreground">Max</Label>
                                    <Input
                                        id="reels_normal_max"
                                        type="number"
                                        step={0.1}
                                        min={0}
                                        value={settings.reels_normal_max_time}
                                        onChange={(e) => onUpdate(prev => ({
                                            ...prev,
                                            reels_normal_max_time: Math.max(0, parseFloat(e.target.value) || 0)
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
