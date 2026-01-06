import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type { InstagramSettings } from '../types';

interface UnfollowSettingsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    settings: InstagramSettings;
    onUpdate: (next: InstagramSettings | ((prev: InstagramSettings) => InstagramSettings)) => void;
}

export function UnfollowSettingsDialog({ open, onOpenChange, settings, onUpdate }: UnfollowSettingsDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Unfollow Settings</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="min_delay">Delay Min (sec)</Label>
                            <Input
                                id="min_delay"
                                type="number"
                                min={1}
                                value={settings.min_delay}
                                onChange={(e) => onUpdate(prev => ({
                                    ...prev,
                                    min_delay: Math.max(1, parseInt(e.target.value) || 1)
                                }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="max_delay">Delay Max (sec)</Label>
                            <Input
                                id="max_delay"
                                type="number"
                                min={1}
                                value={settings.max_delay}
                                onChange={(e) => onUpdate(prev => ({
                                    ...prev,
                                    max_delay: Math.max(1, parseInt(e.target.value) || 1)
                                }))}
                            />
                        </div>
                    </div>

                    <div className="border-t pt-4">
                        <Label className="text-sm font-medium">Unfollow Count per Session</Label>
                        <div className="grid grid-cols-2 gap-4 mt-2">
                            <div className="space-y-2">
                                <Label htmlFor="unfollow_min" className="text-xs text-muted-foreground">Min</Label>
                                <Input
                                    id="unfollow_min"
                                    type="number"
                                    min={1}
                                    value={settings.unfollow_min_count}
                                    onChange={(e) => onUpdate(prev => ({
                                        ...prev,
                                        unfollow_min_count: Math.max(1, parseInt(e.target.value) || 1)
                                    }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="unfollow_max" className="text-xs text-muted-foreground">Max</Label>
                                <Input
                                    id="unfollow_max"
                                    type="number"
                                    min={1}
                                    value={settings.unfollow_max_count}
                                    onChange={(e) => onUpdate(prev => ({
                                        ...prev,
                                        unfollow_max_count: Math.max(1, parseInt(e.target.value) || 1)
                                    }))}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex justify-end pt-4">
                    <Button onClick={() => onOpenChange(false)}>Done</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
