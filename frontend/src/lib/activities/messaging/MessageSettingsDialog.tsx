/**
 * Message Settings Dialog
 * 
 * Dialog for managing message templates used in DM activities.
 * Supports standard and alternative message templates.
 */

import { useState, useEffect, type ComponentProps } from 'react';
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

function DenseButton({ className = '', ...props }: ComponentProps<typeof Button>) {
    return (
        <Button
            variant="outline"
            size="sm"
            className={`h-6 px-2 py-0 text-[11px] rounded-[3px] border-neutral-300 dark:border-neutral-600 shadow-none transition-none bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 ${className}`}
            {...props}
        />
    );
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
            <DialogContent className="max-w-2xl h-[600px] flex flex-col p-0 gap-0 bg-neutral-200 dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700 overflow-hidden">
                <DialogHeader className="px-3 py-2 border-b border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800">
                    <DialogTitle className="text-[11px] font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">Message Templates</DialogTitle>
                    <DialogDescription className="text-[10px] text-neutral-500 dark:text-neutral-400">
                        Manage templates used for automated direct messages.
                    </DialogDescription>
                </DialogHeader>

                <Tabs value={kind} onValueChange={(v) => setKind(v as MessageTemplateKind)} className="flex-1 flex flex-col min-h-0">
                    <div className="flex items-center justify-between px-2 py-1.5 border-b border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/20">
                        <TabsList className="h-6 p-0.5 bg-neutral-200/70 dark:bg-neutral-900/70 border border-neutral-300 dark:border-neutral-700 rounded-[4px]">
                            <TabsTrigger value="message" className="h-5 px-2 rounded-[3px] text-[10px] data-[state=active]:bg-white data-[state=active]:dark:bg-neutral-800 data-[state=active]:shadow-none">
                                Standard
                            </TabsTrigger>
                            <TabsTrigger value="message_2" className="h-5 px-2 rounded-[3px] text-[10px] data-[state=active]:bg-white data-[state=active]:dark:bg-neutral-800 data-[state=active]:shadow-none">
                                Alternative
                            </TabsTrigger>
                        </TabsList>
                        <DenseButton onClick={startCreate} disabled={isCreating || editingIndex !== null || loading}>
                            <Plus className="h-3 w-3 mr-1.5" />
                            Add Template
                        </DenseButton>
                    </div>

                    {error && (
                        <div className="px-3 py-1.5 bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border-b border-red-200 dark:border-red-900/50 text-[11px] font-medium shrink-0">
                            {error}
                        </div>
                    )}

                    <TabsContent value={kind} className="flex-1 mt-0 min-h-0 relative p-1 bg-neutral-200 dark:bg-neutral-900">
                        {loading && !isCreating && editingIndex === null ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-[#121212]/60 z-10">
                                <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />
                            </div>
                        ) : null}

                        <ScrollArea className="h-full border border-neutral-300 dark:border-neutral-700 rounded-[3px] bg-white dark:bg-[#121212]">
                            <div className="space-y-2 p-2 pb-3">
                                {isCreating && (
                                    <Card className="border-blue-500/50 rounded-[3px] shadow-none">
                                        <CardContent className="p-2.5 space-y-2.5">
                                            <div className="flex items-center justify-between">
                                                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">New Template</span>
                                            </div>
                                            <Textarea
                                                value={editValue}
                                                onChange={(e) => setEditValue(e.target.value)}
                                                placeholder="Enter message template..."
                                                className="min-h-[88px] text-[11px] rounded-[2px] border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 focus-visible:ring-1 focus-visible:ring-offset-0"
                                            />
                                            <div className="flex justify-end gap-2">
                                                <DenseButton variant="ghost" size="sm" onClick={cancelEdit}>Cancel</DenseButton>
                                                <Button size="sm" className="h-6 px-2.5 rounded-[3px] text-[11px]" onClick={handleSave}>Save</Button>
                                            </div>
                                        </CardContent>
                                    </Card>
                                )}

                                {templates.length === 0 && !isCreating ? (
                                    <div className="text-center py-10 text-neutral-500 dark:text-neutral-400 border border-dashed border-neutral-300 dark:border-neutral-700 rounded-[3px] bg-neutral-50 dark:bg-neutral-900/40">
                                        <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-25" />
                                        <p className="text-[11px]">No templates found.</p>
                                        <p className="text-[10px]">Create one to get started.</p>
                                    </div>
                                ) : (
                                    templates.map((template, index) => {
                                        if (editingIndex === index) {
                                            return (
                                                <Card key={index} className="border-blue-500/50 rounded-[3px] shadow-none">
                                                    <CardContent className="p-2.5 space-y-2.5">
                                                        <Textarea
                                                            value={editValue}
                                                            onChange={(e) => setEditValue(e.target.value)}
                                                            className="min-h-[88px] text-[11px] rounded-[2px] border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 focus-visible:ring-1 focus-visible:ring-offset-0"
                                                        />
                                                        <div className="flex justify-end gap-2">
                                                            <DenseButton variant="ghost" size="sm" onClick={cancelEdit}>
                                                                <X className="h-3 w-3 mr-1" />
                                                                Cancel
                                                            </DenseButton>
                                                            <Button size="sm" className="h-6 px-2.5 rounded-[3px] text-[11px]" onClick={handleSave}>
                                                                <Save className="h-3 w-3 mr-1" />
                                                                Save
                                                            </Button>
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            );
                                        }

                                        return (
                                            <Card key={index} className="group rounded-[3px] shadow-none border-neutral-300 dark:border-neutral-700 hover:border-blue-400/70 dark:hover:border-blue-500/60 transition-colors">
                                                <CardContent className="p-2.5">
                                                    <div className="flex items-start gap-3">
                                                        <p className="text-[11px] whitespace-pre-wrap flex-1 text-neutral-700 dark:text-neutral-300">{template}</p>
                                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-6 w-6 rounded-[2px] text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-100 hover:bg-neutral-200 dark:hover:bg-neutral-800"
                                                                onClick={() => startEdit(index)}
                                                            >
                                                                <Edit2 className="h-3 w-3" />
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-6 w-6 rounded-[2px] text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                                                                onClick={() => handleDelete(index)}
                                                            >
                                                                <Trash2 className="h-3 w-3" />
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
