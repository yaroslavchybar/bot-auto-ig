/**
 * Message Settings Dialog
 * 
 * Dialog for managing message templates used in DM activities.
 * Supports standard and alternative message templates.
 */

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { useMessageTemplates } from './useMessageTemplates';
import type { MessageTemplateKind } from './useMessageTemplates';
import { Plus, Trash2, Edit2, Save, X, Loader2, MessageSquare } from 'lucide-react';

interface MessageSettingsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function MessageSettingsDialog({ open, onOpenChange }: MessageSettingsDialogProps) {
    const [kind, setKind] = useState<MessageTemplateKind>('message');
    const { templates, loading, error, saveTemplates } = useMessageTemplates(kind);

    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editValue, setEditValue] = useState('');
    const [isCreating, setIsCreating] = useState(false);

    useEffect(() => {
        if (open) {
            setEditingIndex(null);
            setIsCreating(false);
        }
    }, [open, kind]);

    const handleSave = async () => {
        const trimmed = editValue.trim();
        if (!trimmed) {
            setEditingIndex(null);
            setIsCreating(false);
            return;
        }

        const next = [...templates];
        if (isCreating) {
            next.push(trimmed);
        } else if (editingIndex !== null) {
            next[editingIndex] = trimmed;
        }

        try {
            await saveTemplates(kind, next);
            setEditingIndex(null);
            setIsCreating(false);
            setEditValue('');
            toast.success('Template saved');
        } catch {
            toast.error('Failed to save template');
        }
    };

    const handleDelete = async (index: number) => {
        const next = [...templates];
        next.splice(index, 1);
        try {
            await saveTemplates(kind, next);
            toast.success('Template deleted');
        } catch {
            toast.error('Failed to delete template');
        }
    };

    const startEdit = (index: number) => {
        setEditingIndex(index);
        setEditValue(templates[index]);
        setIsCreating(false);
    };

    const startCreate = () => {
        setEditingIndex(null);
        setEditValue('');
        setIsCreating(true);
    };

    const cancelEdit = () => {
        setEditingIndex(null);
        setEditValue('');
        setIsCreating(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl h-[600px] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Message Templates</DialogTitle>
                    <DialogDescription>
                        Manage templates used for automated direct messages.
                    </DialogDescription>
                </DialogHeader>

                <Tabs value={kind} onValueChange={(v) => setKind(v as MessageTemplateKind)} className="flex-1 flex flex-col min-h-0">
                    <div className="flex items-center justify-between mb-4">
                        <TabsList>
                            <TabsTrigger value="message">Standard Messages</TabsTrigger>
                            <TabsTrigger value="message_2">Alternative Messages</TabsTrigger>
                        </TabsList>
                        <Button onClick={startCreate} disabled={isCreating || editingIndex !== null || loading}>
                            <Plus className="h-4 w-4 mr-2" />
                            Add Template
                        </Button>
                    </div>

                    {error && (
                        <div className="p-3 mb-4 rounded-lg bg-destructive/10 text-destructive text-sm">
                            {error}
                        </div>
                    )}

                    <TabsContent value={kind} className="flex-1 mt-0 min-h-0 relative">
                        {loading && !isCreating && editingIndex === null ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
                                <Loader2 className="h-8 w-8 animate-spin" />
                            </div>
                        ) : null}

                        <ScrollArea className="h-full pr-4">
                            <div className="space-y-4 pb-4">
                                {isCreating && (
                                    <Card className="border-primary">
                                        <CardContent className="p-4 space-y-3">
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm font-medium text-primary">New Template</span>
                                            </div>
                                            <Textarea
                                                value={editValue}
                                                onChange={(e) => setEditValue(e.target.value)}
                                                placeholder="Enter message template..."
                                                className="min-h-[100px]"
                                            />
                                            <div className="flex justify-end gap-2">
                                                <Button variant="ghost" size="sm" onClick={cancelEdit}>Cancel</Button>
                                                <Button size="sm" onClick={handleSave}>Save</Button>
                                            </div>
                                        </CardContent>
                                    </Card>
                                )}

                                {templates.length === 0 && !isCreating ? (
                                    <div className="text-center py-12 text-muted-foreground">
                                        <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-20" />
                                        <p>No templates found.</p>
                                        <p className="text-sm">Create one to get started.</p>
                                    </div>
                                ) : (
                                    templates.map((template, index) => {
                                        if (editingIndex === index) {
                                            return (
                                                <Card key={index} className="border-primary">
                                                    <CardContent className="p-4 space-y-3">
                                                        <Textarea
                                                            value={editValue}
                                                            onChange={(e) => setEditValue(e.target.value)}
                                                            className="min-h-[100px]"
                                                        />
                                                        <div className="flex justify-end gap-2">
                                                            <Button variant="ghost" size="sm" onClick={cancelEdit}>
                                                                <X className="h-4 w-4 mr-1" />
                                                                Cancel
                                                            </Button>
                                                            <Button size="sm" onClick={handleSave}>
                                                                <Save className="h-4 w-4 mr-1" />
                                                                Save
                                                            </Button>
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            );
                                        }

                                        return (
                                            <Card key={index} className="group hover:border-accent">
                                                <CardContent className="p-4">
                                                    <div className="flex items-start gap-4">
                                                        <p className="text-sm whitespace-pre-wrap flex-1">{template}</p>
                                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8"
                                                                onClick={() => startEdit(index)}
                                                            >
                                                                <Edit2 className="h-4 w-4" />
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8 text-destructive"
                                                                onClick={() => handleDelete(index)}
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        );
                                    })
                                )}
                            </div>
                        </ScrollArea>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}
