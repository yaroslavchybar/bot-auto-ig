import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Plus, Trash2, Edit2, Save, X, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import type { ActivityInput } from '@/features/workflows/activities/types'

interface TemplateInputProps {
  input: ActivityInput
}

const MACROS = [
  { id: 'userName', label: '{userName}', desc: 'Instagram username' },
  { id: 'fullName', label: '{fullName}', desc: 'Full profile name' },
  { id: 'matchedName', label: '{matchedName}', desc: 'Extracted first name' },
]

export function TemplateInput({ input }: TemplateInputProps) {
  // Get template kind from config for template inputs
  const templateKind = 'message'
  const templates = useQuery(api.messageTemplates.get, {
    kind: templateKind,
  }) as string[] | undefined
  const upsertMutation = useMutation(api.messageTemplates.upsert)

  // Template editing state
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  // Macro popover state
  const [macroDropdownOpen, setMacroDropdownOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Close macro dropdown on outside click or escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMacroDropdownOpen(false)
    }
    if (macroDropdownOpen) {
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [macroDropdownOpen])

  const handleSaveTemplate = async () => {
    const trimmed = editValue.trim()
    if (!trimmed || !templates) {
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
      await upsertMutation({ kind: templateKind, texts: next })
      setEditingIndex(null)
      setIsCreating(false)
      setEditValue('')
      toast.success('Template saved')
    } catch {
      toast.error('Failed to save template')
    }
  }

  const handleDeleteTemplate = async (index: number) => {
    if (!templates) return
    const next = [...templates]
    next.splice(index, 1)
    try {
      await upsertMutation({ kind: templateKind, texts: next })
      toast.success('Template deleted')
    } catch {
      toast.error('Failed to delete template')
    }
  }

  const startEditTemplate = (index: number) => {
    if (!templates) return
    setEditingIndex(index)
    setEditValue(templates[index])
    setIsCreating(false)
  }

  const startCreateTemplate = () => {
    setEditingIndex(null)
    setEditValue('')
    setIsCreating(true)
  }

  const cancelEditTemplate = () => {
    setEditingIndex(null)
    setEditValue('')
    setIsCreating(false)
  }

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setEditValue(val)

    // Check if we should open the macro dropdown
    const cursorPosition = e.target.selectionStart
    const textBeforeCursor = val.slice(0, cursorPosition)

    if (textBeforeCursor.endsWith('/')) {
      setMacroDropdownOpen(true)
    } else {
      setMacroDropdownOpen(false)
    }
  }

  const insertMacro = (macroLabel: string) => {
    if (textareaRef.current) {
      const cursorPosition = textareaRef.current.selectionStart
      const textBeforeCursor = editValue.slice(0, cursorPosition)
      const textAfterCursor = editValue.slice(cursorPosition)

      // Replace the '/' that triggered the dropdown
      let newTextBeforeCursor = textBeforeCursor
      if (textBeforeCursor.endsWith('/')) {
        newTextBeforeCursor = textBeforeCursor.slice(0, -1)
      }

      const newValue = newTextBeforeCursor + macroLabel + textAfterCursor
      setEditValue(newValue)
      setMacroDropdownOpen(false)

      // Try to focus back and restore cursor position after render
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          const newPos = newTextBeforeCursor.length + macroLabel.length
          textareaRef.current.setSelectionRange(newPos, newPos)
        }
      }, 0)
    }
  }

  return (
    <div className="space-y-1">
      <div className="mt-1 mb-0.5 flex items-center justify-between">
        <Label className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
          {input.label}
        </Label>
        <Button
          variant="outline"
          size="sm"
          className="h-6 rounded-[3px] border-neutral-300 bg-white px-2 text-[10px] text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
          onClick={startCreateTemplate}
          disabled={isCreating || editingIndex !== null}
        >
          <Plus className="mr-1 h-3 w-3" />
          Add
        </Button>
      </div>

      {/* New template form */}
      {isCreating && (
        <div className="relative space-y-2 rounded-[3px] border border-blue-500/50 bg-blue-50/40 p-2 dark:bg-blue-950/20">
          <span className="dark:text-status-info text-[10px] font-bold tracking-wider text-blue-600 uppercase">
            NEW TEMPLATE
          </span>

          <Popover open={macroDropdownOpen} onOpenChange={setMacroDropdownOpen}>
            <PopoverTrigger asChild>
              <div className="relative w-full">
                <Textarea
                  ref={textareaRef}
                  value={editValue}
                  onChange={handleTextareaChange}
                  placeholder="Enter message... (type / for macros)"
                  className="min-h-[50px] rounded-[2px] border-neutral-300 bg-white text-[11px] focus-visible:ring-1 focus-visible:ring-offset-0 dark:border-neutral-700 dark:bg-[#121212]"
                />
              </div>
            </PopoverTrigger>
            <PopoverContent
              className="w-48 rounded-[2px] border border-neutral-300 p-0 shadow-md dark:border-neutral-700"
              align="start"
              sideOffset={4}
              onOpenAutoFocus={(e: Event) => e.preventDefault()}
            >
              <div className="max-h-60 overflow-y-auto bg-white dark:bg-[#121212]">
                {MACROS.map((macro) => (
                  <Button
                    key={macro.id}
                    variant="ghost"
                    className="h-auto w-full justify-start rounded-none px-2 py-1.5 text-[11px] font-normal hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    onClick={() => insertMacro(macro.label)}
                  >
                    <div className="flex flex-col items-start gap-0.5">
                      <span className="dark:text-status-info rounded-[2px] border border-neutral-200 bg-neutral-100 px-1 font-mono text-[10px] text-blue-600 dark:border-neutral-700 dark:bg-neutral-800">
                        {macro.label}
                      </span>
                      <span className="text-[10px] text-neutral-500 dark:text-neutral-400">
                        {macro.desc}
                      </span>
                    </div>
                  </Button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <div className="flex justify-end gap-1.5 border-t border-blue-200 pt-1 dark:border-blue-900/50">
            <Button
              variant="outline"
              size="sm"
              className="h-6 rounded-[3px] border-neutral-300 bg-white px-2.5 text-[10px] text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
              onClick={cancelEditTemplate}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-6 rounded-[3px] bg-blue-600 px-2.5 text-[10px] text-white hover:bg-blue-700"
              onClick={handleSaveTemplate}
            >
              Save
            </Button>
          </div>
        </div>
      )}

      {templates === undefined ? (
        <div className="py-2 text-[10px] text-neutral-400">
          Loading templates...
        </div>
      ) : templates.length === 0 && !isCreating ? (
        <div className="rounded-[3px] border border-dashed border-neutral-300 bg-neutral-50 p-3 text-center dark:border-neutral-700 dark:bg-neutral-900/30">
          <MessageSquare className="mx-auto mb-1 h-4 w-4 text-neutral-400 opacity-20" />
          <p className="text-[10px] text-neutral-400">No templates</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {templates.map((template, index) => {
            if (editingIndex === index) {
              return (
                <div
                  key={index}
                  className="relative space-y-1.5 rounded-[3px] border border-neutral-400/50 bg-neutral-50 p-1.5 dark:border-neutral-600 dark:bg-neutral-900/50"
                >
                  <Popover
                    open={macroDropdownOpen}
                    onOpenChange={setMacroDropdownOpen}
                  >
                    <PopoverTrigger asChild>
                      <div className="relative w-full">
                        <Textarea
                          ref={textareaRef}
                          value={editValue}
                          onChange={handleTextareaChange}
                          className="min-h-[50px] rounded-[2px] border-neutral-300 bg-white text-[11px] focus-visible:ring-1 focus-visible:ring-offset-0 dark:border-neutral-700 dark:bg-[#121212]"
                          placeholder="Enter message... (type / for macros)"
                        />
                      </div>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-48 rounded-[2px] border border-neutral-300 p-0 shadow-md dark:border-neutral-700"
                      align="start"
                      sideOffset={4}
                      onOpenAutoFocus={(e: Event) => e.preventDefault()}
                    >
                      <div className="max-h-60 overflow-y-auto bg-white dark:bg-[#121212]">
                        {MACROS.map((macro) => (
                          <Button
                            key={macro.id}
                            variant="ghost"
                            className="h-auto w-full justify-start rounded-none px-2 py-1.5 text-[11px] font-normal hover:bg-neutral-100 dark:hover:bg-neutral-800"
                            onClick={() => insertMacro(macro.label)}
                          >
                            <div className="flex flex-col items-start gap-0.5">
                              <span className="dark:text-status-info rounded-[2px] border border-neutral-200 bg-neutral-100 px-1 font-mono text-[10px] text-blue-600 dark:border-neutral-700 dark:bg-neutral-800">
                                {macro.label}
                              </span>
                              <span className="text-[10px] text-neutral-500 dark:text-neutral-400">
                                {macro.desc}
                              </span>
                            </div>
                          </Button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 rounded-[2px] px-1.5 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"
                      onClick={cancelEditTemplate}
                    >
                      <X className="h-[10px] w-[10px]" />
                    </Button>
                    <Button
                      size="sm"
                      className="h-5 rounded-[2px] bg-neutral-700 px-1.5 hover:bg-neutral-800 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-neutral-100"
                      onClick={handleSaveTemplate}
                    >
                      <Save className="h-[10px] w-[10px]" />
                    </Button>
                  </div>
                </div>
              )
            }
            return (
              <div
                key={index}
                className="group rounded-[3px] border border-neutral-300 bg-neutral-50 p-1.5 transition-colors hover:border-blue-400 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-blue-500/50"
              >
                <div className="flex items-start gap-1.5">
                  <p className="flex-1 text-[11px] font-medium break-words whitespace-pre-wrap text-neutral-600 dark:text-neutral-300">
                    {template.length > 80
                      ? template.slice(0, 80) + '...'
                      : template}
                  </p>
                  <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 rounded-[2px] text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                      onClick={() => startEditTemplate(index)}
                    >
                      <Edit2 className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-status-danger h-5 w-5 rounded-[2px] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                      onClick={() => handleDeleteTemplate(index)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {input.helpText && (
        <p className="pt-1 text-[10px] leading-tight text-neutral-500 dark:text-neutral-400">
          {input.helpText}
        </p>
      )}
    </div>
  )
}



