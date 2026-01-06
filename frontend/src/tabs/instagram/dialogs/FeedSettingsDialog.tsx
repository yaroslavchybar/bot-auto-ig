import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type { InstagramSettings } from '../types';

interface FeedSettingsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    settings: InstagramSettings;
    onUpdate: (next: InstagramSettings | ((prev: InstagramSettings) => InstagramSettings)) => void;
}

export function FeedSettingsDialog({ open, onOpenChange, settings, onUpdate }: FeedSettingsDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Feed Settings</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="feed_min_time">Min Time (min)</Label>
                            <Input
                                id="feed_min_time"
                                type="number"
                                min={1}
                                value={settings.feed_min_time_minutes}
                                onChange={(e) => onUpdate(prev => ({
                                    ...prev,
                                    feed_min_time_minutes: Math.max(1, parseInt(e.target.value) || 1)
                                }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="feed_max_time">Max Time (min)</Label>
                            <Input
                                id="feed_max_time"
                                type="number"
                                min={1}
                                value={settings.feed_max_time_minutes}
                                onChange={(e) => onUpdate(prev => ({
                                    ...prev,
                                    feed_max_time_minutes: Math.max(1, parseInt(e.target.value) || 1)
                                }))}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="like_chance">Like Chance (%)</Label>
                        <div className="flex items-center gap-2">
                            <Input
                                id="like_chance"
                                type="range"
                                min={0}
                                max={100}
                                value={settings.like_chance}
                                onChange={(e) => onUpdate(prev => ({
                                    ...prev,
                                    like_chance: parseInt(e.target.value) || 0
                                }))}
                                className="flex-1"
                            />
                            <span className="w-12 text-right text-sm">{settings.like_chance}%</span>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="follow_chance">Follow Chance (%)</Label>
                        <div className="flex items-center gap-2">
                            <Input
                                id="follow_chance"
                                type="range"
                                min={0}
                                max={100}
                                value={settings.follow_chance}
                                onChange={(e) => onUpdate(prev => ({
                                    ...prev,
                                    follow_chance: parseInt(e.target.value) || 0
                                }))}
                                className="flex-1"
                            />
                            <span className="w-12 text-right text-sm">{settings.follow_chance}%</span>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="carousel_watch_chance">Carousel Watch Chance (%)</Label>
                        <div className="flex items-center gap-2">
                            <Input
                                id="carousel_watch_chance"
                                type="range"
                                min={0}
                                max={100}
                                value={settings.carousel_watch_chance}
                                onChange={(e) => onUpdate(prev => ({
                                    ...prev,
                                    carousel_watch_chance: parseInt(e.target.value) || 0
                                }))}
                                className="flex-1"
                            />
                            <span className="w-12 text-right text-sm">{settings.carousel_watch_chance}%</span>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="carousel_max_slides">Carousel Max Slides</Label>
                        <Input
                            id="carousel_max_slides"
                            type="number"
                            min={1}
                            max={10}
                            value={settings.carousel_max_slides}
                            onChange={(e) => onUpdate(prev => ({
                                ...prev,
                                carousel_max_slides: Math.max(1, Math.min(10, parseInt(e.target.value) || 1))
                            }))}
                        />
                    </div>
                </div>

                <div className="flex justify-end pt-4">
                    <Button onClick={() => onOpenChange(false)}>Done</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
