/**
 * Message Settings Dialog
 *
 * Dialog for managing message templates used in DM activities.
 * Supports standard and alternative message templates.
 */

import { useState, useEffect, type ComponentProps } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card, CardContent } from '@/components/ui/card'
import { useMessageTemplates } from './useMessageTemplates'
import type { MessageTemplateKind } from './useMessageTemplates'
import {
  Plus,
  Trash2,
  Edit2,
  Save,
  X,
  Loader2,
  MessageSquare,
} from 'lucide-react'

interface MessageSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function DenseButton({
  className = '',
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={`h-6 rounded-[3px] border-neutral-300 bg-white px-2 py-0 text-[11px] text-neutral-700 shadow-none transition-none hover:bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 ${className}`}
      {...props}
    />
  )
}

export function MessageSettingsDialog({
  open,
  onOpenChange,
}: MessageSettingsDialogProps) {
  const [kind, setKind] = useState<MessageTemplateKind>('message')
  const { templates, loading, error, saveTemplates } = useMessageTemplates(kind)

  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  useEffect(() => {
    if (open) {
      setEditingIndex(null)
      setIsCreating(false)
    }
  }, [open, kind])

  const handleSave = async () => {
    const trimmed = editValue.trim()
    if (!trimmed) {
      setEditingIndex(null)
      setIsCreating(false)
      return
    }

    const next = [...templates]
    if (isCreating) {
      next.push(trimmed)
    } else if (editingIndex !== null) {
      next[editingIndex] = trimmed
    }

    try {
      await saveTemplates(kind, next)
      setEditingIndex(null)
      setIsCreating(false)
      setEditValue('')
      toast.success('Template saved')
    } catch {
      toast.error('Failed to save template')
    }
  }

  const handleDelete = async (index: number) => {
    const next = [...templates]
    next.splice(index, 1)
    try {
      await saveTemplates(kind, next)
      toast.success('Template deleted')
    } catch {
      toast.error('Failed to delete template')
    }
  }

  const startEdit = (index: number) => {
    setEditingIndex(index)
    setEditValue(templates[index])
    setIsCreating(false)
  }

  const startCreate = () => {
    setEditingIndex(null)
    setEditValue('')
    setIsCreating(true)
  }

  const cancelEdit = () => {
    setEditingIndex(null)
    setEditValue('')
    setIsCreating(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[600px] max-w-2xl flex-col gap-0 overflow-hidden border-neutral-300 bg-neutral-200 p-0 dark:border-neutral-700 dark:bg-neutral-900">
        <DialogHeader className="border-b border-neutral-300 bg-neutral-100 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800">
          <DialogTitle className="text-[11px] font-bold tracking-wider text-neutral-700 uppercase dark:text-neutral-300">
            Message Templates
          </DialogTitle>
          <DialogDescription className="text-[10px] text-neutral-500 dark:text-neutral-400">
            Manage templates used for automated direct messages.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={kind}
          onValueChange={(v) => setKind(v as MessageTemplateKind)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="bg-panel-muted0 flex items-center justify-between border-b border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900/20">
            <TabsList className="h-6 rounded-[4px] border border-neutral-300 bg-neutral-200/70 p-0.5 dark:border-neutral-700 dark:bg-neutral-900/70">
              <TabsTrigger
                value="message"
                className="h-5 rounded-[3px] px-2 text-[10px] data-[state=active]:bg-white data-[state=active]:shadow-none data-[state=active]:dark:bg-neutral-800"
              >
                Standard
              </TabsTrigger>
              <TabsTrigger
                value="message_2"
                className="h-5 rounded-[3px] px-2 text-[10px] data-[state=active]:bg-white data-[state=active]:shadow-none data-[state=active]:dark:bg-neutral-800"
              >
                Alternative
              </TabsTrigger>
            </TabsList>
            <DenseButton
              onClick={startCreate}
              disabled={isCreating || editingIndex !== null || loading}
            >
              <Plus className="mr-1.5 h-3 w-3" />
              Add Template
            </DenseButton>
          </div>

          {error && (
            <div className="dark:text-status-danger shrink-0 border-b border-red-200 bg-red-100 px-3 py-1.5 text-[11px] font-medium text-red-800 dark:border-red-900/50 dark:bg-red-950">
              {error}
            </div>
          )}

          <TabsContent
            value={kind}
            className="relative mt-0 min-h-0 flex-1 bg-neutral-200 p-1 dark:bg-neutral-900"
          >
            {loading && !isCreating && editingIndex === null ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 dark:bg-[#121212]/60">
                <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />
              </div>
            ) : null}

            <ScrollArea className="h-full rounded-[3px] border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-[#121212]">
              <div className="space-y-2 p-2 pb-3">
                {isCreating && (
                  <Card className="border-line-strong rounded-[3px] shadow-none">
                    <CardContent className="space-y-2.5 p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-copy text-[10px] font-bold tracking-wider uppercase">
                          New Template
                        </span>
                      </div>
                      <Textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        placeholder="Enter message template..."
                        className="min-h-[88px] rounded-[2px] border-neutral-300 bg-white text-[11px] focus-visible:ring-1 focus-visible:ring-offset-0 dark:border-neutral-700 dark:bg-neutral-900"
                      />
                      <div className="flex justify-end gap-2">
                        <DenseButton
                          variant="ghost"
                          size="sm"
                          onClick={cancelEdit}
                        >
                          Cancel
                        </DenseButton>
                        <Button
                          size="sm"
                          className="h-6 rounded-[3px] px-2.5 text-[11px]"
                          onClick={handleSave}
                        >
                          Save
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {templates.length === 0 && !isCreating ? (
                  <div className="rounded-[3px] border border-dashed border-neutral-300 bg-neutral-50 py-10 text-center text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900/40 dark:text-neutral-400">
                    <MessageSquare className="mx-auto mb-2 h-8 w-8 opacity-25" />
                    <p className="text-[11px]">No templates found.</p>
                    <p className="text-[10px]">Create one to get started.</p>
                  </div>
                ) : (
                  templates.map((template, index) => {
                    if (editingIndex === index) {
                      return (
                        <Card
                          key={index}
                          className="border-line-strong rounded-[3px] shadow-none"
                        >
                          <CardContent className="space-y-2.5 p-2.5">
                            <Textarea
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="min-h-[88px] rounded-[2px] border-neutral-300 bg-white text-[11px] focus-visible:ring-1 focus-visible:ring-offset-0 dark:border-neutral-700 dark:bg-neutral-900"
                            />
                            <div className="flex justify-end gap-2">
                              <DenseButton
                                variant="ghost"
                                size="sm"
                                onClick={cancelEdit}
                              >
                                <X className="mr-1 h-3 w-3" />
                                Cancel
                              </DenseButton>
                              <Button
                                size="sm"
                                className="h-6 rounded-[3px] px-2.5 text-[11px]"
                                onClick={handleSave}
                              >
                                <Save className="mr-1 h-3 w-3" />
                                Save
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      )
                    }

                    return (
                      <Card
                        key={index}
                        className="border-line hover:border-line-strong group rounded-[3px] shadow-none transition-colors"
                      >
                        <CardContent className="p-2.5">
                          <div className="flex items-start gap-3">
                            <p className="flex-1 text-[11px] whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">
                              {template}
                            </p>
                            <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 rounded-[2px] text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                                onClick={() => startEdit(index)}
                              >
                                <Edit2 className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-status-danger h-6 w-6 rounded-[2px] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                                onClick={() => handleDelete(index)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}


