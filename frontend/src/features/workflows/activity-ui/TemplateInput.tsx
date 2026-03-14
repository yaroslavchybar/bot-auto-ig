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
  config?: Record<string, unknown>
}

const MACROS = [
  { id: 'userName', label: '{userName}', desc: 'Instagram username' },
  { id: 'fullName', label: '{fullName}', desc: 'Full profile name' },
  { id: 'matchedName', label: '{matchedName}', desc: 'Extracted first name' },
]

function resolveTemplateKind(
  input: ActivityInput,
  config?: Record<string, unknown>,
): 'message' | 'message_2' {
  const fieldName = input.templateKindField
  const rawValue =
    fieldName && config ? String(config[fieldName] ?? '').trim() : ''
  return rawValue === 'message_2' ? 'message_2' : 'message'
}

/* ── Macro dropdown content ── */

function MacroDropdownContent({
  macroDropdownOpen,
  onOpenChange,
  insertMacro,
  children,
}: {
  macroDropdownOpen: boolean
  onOpenChange: (open: boolean) => void
  insertMacro: (label: string) => void
  children: React.ReactNode
}) {
  return (
    <Popover open={macroDropdownOpen} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="border-line bg-panel w-48 rounded-[2px] p-0 shadow-md"
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(e: Event) => e.preventDefault()}
      >
        <div className="bg-panel max-h-60 overflow-y-auto">
          {MACROS.map((macro) => (
            <Button
              key={macro.id}
              variant="ghost"
              className="hover:bg-panel-hover h-auto w-full justify-start rounded-none px-2 py-1.5 text-[11px] font-normal"
              onClick={() => insertMacro(macro.label)}
            >
              <div className="flex flex-col items-start gap-0.5">
                <span className="border-line bg-panel-muted text-copy rounded-[2px] border px-1 font-mono text-[10px]">
                  {macro.label}
                </span>
                <span className="text-subtle-copy text-[10px]">{macro.desc}</span>
              </div>
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/* ── New template form ── */

function TemplateCreateForm(props: SharedEditorProps) {
  return (
    <div className="bg-panel-subtle border-line-strong relative space-y-2 rounded-[3px] border p-2">
      <span className="text-copy text-[10px] font-bold tracking-wider uppercase">
        NEW TEMPLATE
      </span>
      <TemplateTextarea {...props} placeholder="Enter message... (type / for macros)" />
      <div className="border-line-soft flex justify-end gap-1.5 border-t pt-1">
        <Button variant="outline" size="sm"
          className="border-line bg-panel text-copy hover:bg-panel-hover h-6 rounded-[3px] px-2.5 text-[10px]"
          onClick={props.onCancel}>Cancel</Button>
        <Button size="sm"
          className="brand-button h-6 rounded-[3px] px-2.5 text-[10px]"
          onClick={props.onSave}>Save</Button>
      </div>
    </div>
  )
}

/* ── Inline template editor ── */

function TemplateEditItem(props: SharedEditorProps) {
  return (
    <div className="border-line-strong bg-panel-subtle relative space-y-1.5 rounded-[3px] border p-1.5">
      <TemplateTextarea {...props} placeholder="Enter message... (type / for macros)" />
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="sm"
          className="h-5 rounded-[2px] px-1.5 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"
          onClick={props.onCancel}>
          <X className="h-[10px] w-[10px]" />
        </Button>
        <Button size="sm"
          className="h-5 rounded-[2px] bg-neutral-700 px-1.5 hover:bg-neutral-800 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-neutral-100"
          onClick={props.onSave}>
          <Save className="h-[10px] w-[10px]" />
        </Button>
      </div>
    </div>
  )
}

/* ── Shared textarea with macro dropdown ── */

interface SharedEditorProps {
  editValue: string
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  macroDropdownOpen: boolean
  onMacroDropdownChange: (open: boolean) => void
  onTextareaChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  insertMacro: (label: string) => void
  onCancel: () => void
  onSave: () => void
}

function TemplateTextarea({
  editValue,
  textareaRef,
  macroDropdownOpen,
  onMacroDropdownChange,
  onTextareaChange,
  insertMacro,
  placeholder,
}: SharedEditorProps & { placeholder?: string }) {
  return (
    <MacroDropdownContent
      macroDropdownOpen={macroDropdownOpen}
      onOpenChange={onMacroDropdownChange}
      insertMacro={insertMacro}
    >
      <div className="relative w-full">
        <Textarea
          ref={textareaRef}
          value={editValue}
          onChange={onTextareaChange}
          placeholder={placeholder}
          className="border-line bg-field min-h-[50px] rounded-[2px] text-[11px] focus-visible:ring-1 focus-visible:ring-offset-0"
        />
      </div>
    </MacroDropdownContent>
  )
}

/* ── Read-only template display ── */

function TemplateDisplayItem({
  template,
  index,
  onStartEdit,
  onDelete,
}: {
  template: string
  index: number
  onStartEdit: (index: number) => void
  onDelete: (index: number) => void
}) {
  return (
    <div className="border-line bg-panel-subtle hover:border-line-strong group rounded-[3px] border p-1.5 transition-colors">
      <div className="flex items-start gap-1.5">
        <p className="flex-1 text-[11px] font-medium break-words whitespace-pre-wrap text-neutral-600 dark:text-neutral-300">
          {template.length > 80 ? template.slice(0, 80) + '...' : template}
        </p>
        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <Button variant="ghost" size="icon"
            className="h-5 w-5 rounded-[2px] text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            onClick={() => onStartEdit(index)}>
            <Edit2 className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon"
            className="text-status-danger h-5 w-5 rounded-[2px] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
            onClick={() => onDelete(index)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ── Template editing logic ── */

function useTemplateEditor(
  templates: string[] | undefined,
  templateKind: 'message' | 'message_2',
  upsertMutation: ReturnType<typeof useMutation<typeof api.messageTemplates.upsert>>,
) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [macroDropdownOpen, setMacroDropdownOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMacroDropdownOpen(false)
    }
    if (macroDropdownOpen) document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [macroDropdownOpen])

  const handleSave = async () => {
    const trimmed = editValue.trim()
    if (!trimmed || !templates) { setEditingIndex(null); setIsCreating(false); return }
    const next = [...templates]
    if (isCreating) next.push(trimmed)
    else if (editingIndex !== null) next[editingIndex] = trimmed
    try {
      await upsertMutation({ kind: templateKind, texts: next })
      setEditingIndex(null); setIsCreating(false); setEditValue('')
      toast.success('Template saved')
    } catch { toast.error('Failed to save template') }
  }

  const handleDelete = async (index: number) => {
    if (!templates) return
    const next = [...templates]; next.splice(index, 1)
    try {
      await upsertMutation({ kind: templateKind, texts: next })
      toast.success('Template deleted')
    } catch { toast.error('Failed to delete template') }
  }

  const startEdit = (index: number) => {
    if (!templates) return
    setEditingIndex(index); setEditValue(templates[index]); setIsCreating(false)
  }

  const startCreate = () => { setEditingIndex(null); setEditValue(''); setIsCreating(true) }
  const cancelEdit = () => { setEditingIndex(null); setEditValue(''); setIsCreating(false) }

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setEditValue(val)
    const cursorPosition = e.target.selectionStart
    const textBeforeCursor = val.slice(0, cursorPosition)
    setMacroDropdownOpen(textBeforeCursor.endsWith('/'))
  }

  const insertMacro = (macroLabel: string) => {
    if (!textareaRef.current) return
    const cursorPosition = textareaRef.current.selectionStart
    const before = editValue.slice(0, cursorPosition)
    const after = editValue.slice(cursorPosition)
    const newBefore = before.endsWith('/') ? before.slice(0, -1) : before
    setEditValue(newBefore + macroLabel + after)
    setMacroDropdownOpen(false)
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        const newPos = newBefore.length + macroLabel.length
        textareaRef.current.setSelectionRange(newPos, newPos)
      }
    }, 0)
  }

  return {
    editingIndex, editValue, isCreating, macroDropdownOpen, textareaRef,
    setMacroDropdownOpen, handleSave, handleDelete, startEdit, startCreate,
    cancelEdit, handleTextareaChange, insertMacro,
  }
}

/* ── Main Component ── */

export function TemplateInput({ input, config }: TemplateInputProps) {
  const templateKind = resolveTemplateKind(input, config)
  const templates = useQuery(api.messageTemplates.get, { kind: templateKind }) as string[] | undefined
  const upsertMutation = useMutation(api.messageTemplates.upsert)
  const editor = useTemplateEditor(templates, templateKind, upsertMutation)

  const sharedEditorProps: SharedEditorProps = {
    editValue: editor.editValue,
    textareaRef: editor.textareaRef,
    macroDropdownOpen: editor.macroDropdownOpen,
    onMacroDropdownChange: editor.setMacroDropdownOpen,
    onTextareaChange: editor.handleTextareaChange,
    insertMacro: editor.insertMacro,
    onCancel: editor.cancelEdit,
    onSave: editor.handleSave,
  }

  return (
    <div className="space-y-1">
      <div className="mt-1 mb-0.5 flex items-center justify-between">
        <Label className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
          {input.label}
        </Label>
        <Button variant="outline" size="sm"
          className="border-line bg-panel text-copy hover:bg-panel-hover h-6 rounded-[3px] px-2 text-[10px]"
          onClick={editor.startCreate}
          disabled={editor.isCreating || editor.editingIndex !== null}>
          <Plus className="mr-1 h-3 w-3" />Add
        </Button>
      </div>

      {editor.isCreating && <TemplateCreateForm {...sharedEditorProps} />}

      <TemplateListContent
        templates={templates}
        isCreating={editor.isCreating}
        editingIndex={editor.editingIndex}
        sharedEditorProps={sharedEditorProps}
        onStartEdit={editor.startEdit}
        onDelete={editor.handleDelete}
      />

      {input.helpText && (
        <p className="pt-1 text-[10px] leading-tight text-neutral-500 dark:text-neutral-400">
          {input.helpText}
        </p>
      )}
    </div>
  )
}

/* ── Template List Content ── */

function TemplateListContent({
  templates,
  isCreating,
  editingIndex,
  sharedEditorProps,
  onStartEdit,
  onDelete,
}: {
  templates: string[] | undefined
  isCreating: boolean
  editingIndex: number | null
  sharedEditorProps: SharedEditorProps
  onStartEdit: (index: number) => void
  onDelete: (index: number) => void
}) {
  if (templates === undefined) {
    return <div className="text-subtle-copy py-2 text-[10px]">Loading templates...</div>
  }

  if (templates.length === 0 && !isCreating) {
    return (
      <div className="border-line bg-panel-subtle rounded-[3px] border border-dashed p-3 text-center">
        <MessageSquare className="text-subtle-copy mx-auto mb-1 h-4 w-4 opacity-20" />
        <p className="text-subtle-copy text-[10px]">No templates</p>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {templates.map((template, index) => {
        if (editingIndex === index) {
          return <TemplateEditItem key={index} {...sharedEditorProps} />
        }
        return (
          <TemplateDisplayItem
            key={index}
            template={template}
            index={index}
            onStartEdit={onStartEdit}
            onDelete={onDelete}
          />
        )
      })}
    </div>
  )
}
